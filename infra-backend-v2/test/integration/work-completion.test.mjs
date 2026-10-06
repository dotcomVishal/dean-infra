// Post-approval loop: JE resolves -> applicant is mailed once and either closes it or
// sends it back to where it was resolved from. Plus uploads by any desk.
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { confirmCompletion, uploadAttachments } from '../../src/controllers/ticketController.js';
import { applyTenderStage, resolveTicket } from '../../src/controllers/tenderController.js';
import { processDueNotifications } from '../../src/cron/emailReminders.js';
import { makeUser, makeOpenTicket, cleanup, pool } from './helpers.mjs';

beforeEach(cleanup);
after(async () => { await cleanup(); await pool.end(); });

async function call(handler, { user, ticketId, body = {}, files }) {
  const out = { status: 200 };
  const res = {
    status(c) { out.status = c; return this; },
    json(b) { out.body = b; return this; },
    setHeader() {}, headersSent: false,
  };
  await handler({ user, params: { ticket_id: String(ticketId) }, body, files, headers: {}, get: () => undefined }, res);
  return out;
}
const statusOf = async (id) => (await pool.query('SELECT status FROM mnt_tickets WHERE id = ?', [id]))[0][0].status;
const liveReminders = async (id) => (await pool.query(
  "SELECT desk, to_user_id, audience FROM mnt_notifications WHERE ticket_id = ? AND kind = 'REMINDER' AND status = 'PENDING'", [id]))[0];

test('JE completes -> applicant mailed once; dispute reopens; confirm closes', async () => {
  const applicantId = await makeUser({ role: 'APPLICANT' });
  const jeId = await makeUser({ role: 'JE' });
  const id = await makeOpenTicket(applicantId, jeId, 'WORK_IN_PROGRESS');
  const je = { id: jeId, role: 'JE', name: 'CI JE' };
  const applicant = { id: applicantId, role: 'APPLICANT', name: 'CI Applicant' };

  // The JE cannot close it: there is no such stage. Only the applicant closes.
  assert.equal((await call(applyTenderStage, { user: je, ticketId: id, body: { stage: 'CLOSE' } })).status, 400);

  const resolve = () => call(resolveTicket, { user: je, ticketId: id, body: { note: 'Work completed on site' } });
  assert.equal((await resolve()).status, 200);
  assert.equal(await statusOf(id), 'WORK_COMPLETED');
  // Policy: the applicant gets ONE "resolved" mail and is never reminded; nobody else is mailed.
  assert.deepEqual(await liveReminders(id), []);
  const sent = [];
  await processDueNotifications({ now: new Date(Date.now() + 60_000), send: async (m) => { sent.push(m); } });
  assert.deepEqual(sent.map((m) => m.subject), [`[Infra] TKT-${String(id).padStart(4, '0')}: Work completed, please confirm`]);
  await processDueNotifications({ now: new Date(Date.now() + 100 * 3600e3), send: async (m) => { sent.push(m); } });
  assert.equal(sent.length, 1, 'no reminder follows');

  // Someone else cannot answer; a dispute needs a reason.
  const stranger = { id: jeId, role: 'APPLICANT' };
  assert.equal((await call(confirmCompletion, { user: stranger, ticketId: id, body: { accepted: true } })).status, 404);
  assert.equal((await call(confirmCompletion, { user: applicant, ticketId: id, body: { accepted: false } })).status, 400);

  assert.equal((await call(confirmCompletion, { user: applicant, ticketId: id, body: { accepted: false, remarks: 'Still leaks' } })).status, 200);
  assert.equal(await statusOf(id), 'WORK_IN_PROGRESS');
  // The JE hears the comment; the applicant is not mailed for the send-back.
  const [toJe] = await pool.query("SELECT subject, body FROM mnt_notifications WHERE ticket_id = ? AND to_user_id = ? AND status = 'PENDING'", [id, jeId]);
  assert.equal(toJe.length, 1);
  assert.match(toJe[0].subject, /Sent back by the applicant/);
  assert.match(toJe[0].body, /Still leaks/);

  assert.equal((await resolve()).status, 200);
  assert.equal((await call(confirmCompletion, { user: applicant, ticketId: id, body: { accepted: true } })).status, 200);
  assert.equal(await statusOf(id), 'CLOSED');
  assert.equal((await liveReminders(id)).length, 0);
  const [closed] = await pool.query("SELECT subject FROM mnt_notifications WHERE ticket_id = ? AND to_user_id = ? ORDER BY id DESC LIMIT 1", [id, applicantId]);
  assert.match(closed[0].subject, /: Closed$/);
  // The JE is told the applicant closed it; both mails carry an HTML part.
  const [toJeClosed] = await pool.query("SELECT subject, body_html FROM mnt_notifications WHERE ticket_id = ? AND to_user_id = ? ORDER BY id DESC LIMIT 1", [id, jeId]);
  assert.match(toJeClosed[0].subject, /: Closed by the applicant$/);
  assert.ok(toJeClosed[0].body_html.startsWith('<!doctype html>'));

  const [log] = await pool.query('SELECT action FROM mnt_audit_logs WHERE ticket_id = ? ORDER BY id', [id]);
  assert.deepEqual(log.map((r) => r.action), ['RESOLVED', 'SENT_BACK', 'RESOLVED', 'CLOSED']);
});

test('applicant closes a ticket they raised as the JE: one mail, not two', async () => {
  const jeId = await makeUser({ role: 'JE' });
  const id = await makeOpenTicket(jeId, jeId, 'WORK_COMPLETED');
  assert.equal((await call(confirmCompletion, { user: { id: jeId, role: 'JE', name: 'CI JE' }, ticketId: id, body: { accepted: true } })).status, 200);
  const [rows] = await pool.query("SELECT subject FROM mnt_notifications WHERE ticket_id = ? AND to_user_id = ?", [id, jeId]);
  assert.deepEqual(rows.map((r) => r.subject.replace(/^\[Infra\] TKT-\d+: /, '')), ['Closed']);
});

test('uploads: category from the uploader; outsiders and closed tickets refused', async () => {
  const applicantId = await makeUser({ role: 'APPLICANT' });
  const jeId = await makeUser({ role: 'JE' });
  const seId = await makeUser({ role: 'SE' });
  const otherJe = await makeUser({ role: 'JE' });
  const id = await makeOpenTicket(applicantId, jeId, 'PENDING_SE_APPROVAL');

  const tempDir = path.resolve('uploads/temp');
  fs.mkdirSync(tempDir, { recursive: true });
  const fakeFile = () => {
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}-quote.pdf`;
    const p = path.join(tempDir, filename);
    fs.writeFileSync(p, '%PDF-1.4 ci');
    return { path: p, filename, fieldname: 'files' };
  };

  const up = (user) => call(uploadAttachments, { user, ticketId: id, files: [fakeFile()] });
  const se = await up({ id: seId, role: 'SE' });
  assert.equal(se.status, 201);
  assert.equal(se.body.category, 'DESK_DOC');
  assert.equal((await up({ id: applicantId, role: 'APPLICANT' })).body.category, 'APPLICANT_EVIDENCE');
  assert.equal((await up({ id: otherJe, role: 'JE' })).status, 403);

  await pool.query("UPDATE mnt_tickets SET status = 'CLOSED' WHERE id = ?", [id]);
  assert.equal((await up({ id: seId, role: 'SE' })).status, 403);

  fs.rmSync(path.resolve('uploads/tickets', String(id)), { recursive: true, force: true });
});
