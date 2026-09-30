// Post-approval loop: JE marks work complete -> applicant is reminded until they
// confirm (CLOSED) or dispute (back to WORK_IN_PROGRESS). Plus uploads by any desk.
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  updateTenderStatus, confirmCompletion, uploadAttachments,
} from '../../src/controllers/ticketController.js';
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
const statusOf = async (id) => (await pool.query('SELECT status FROM tickets WHERE id = ?', [id]))[0][0].status;
const liveReminders = async (id) => (await pool.query(
  "SELECT desk, to_user_id, audience FROM notifications WHERE ticket_id = ? AND kind = 'REMINDER' AND status = 'PENDING'", [id]))[0];

test('JE completes -> applicant reminded; dispute reopens; confirm closes', async () => {
  const applicantId = await makeUser({ role: 'APPLICANT' });
  const jeId = await makeUser({ role: 'JE' });
  const id = await makeOpenTicket(applicantId, jeId, 'WORK_IN_PROGRESS');
  const je = { id: jeId, role: 'JE', name: 'CI JE' };
  const applicant = { id: applicantId, role: 'APPLICANT', name: 'CI Applicant' };

  // JE may not close it any more.
  assert.equal((await call(updateTenderStatus, { user: je, ticketId: id, body: { milestone: 'CLOSED' } })).status, 400);

  assert.equal((await call(updateTenderStatus, { user: je, ticketId: id, body: { milestone: 'WORK_COMPLETED' } })).status, 200);
  assert.equal(await statusOf(id), 'WORK_COMPLETED');
  assert.deepEqual(await liveReminders(id), [{ desk: 'APPLICANT', to_user_id: applicantId, audience: 'APPLICANT' }]);

  // The worker sends the first reminder now, and keeps the series alive.
  const sent = [];
  await processDueNotifications({ now: new Date(Date.now() + 60_000), send: async (m) => { sent.push(m); } });
  assert.ok(sent.some((m) => /verify the completed work/.test(m.subject)), 'verify mail sent');
  assert.equal((await liveReminders(id)).length, 1, 'series still live after a send');

  // Someone else cannot answer; a dispute needs a reason.
  const stranger = { id: jeId, role: 'APPLICANT' };
  assert.equal((await call(confirmCompletion, { user: stranger, ticketId: id, body: { accepted: true } })).status, 404);
  assert.equal((await call(confirmCompletion, { user: applicant, ticketId: id, body: { accepted: false } })).status, 400);

  assert.equal((await call(confirmCompletion, { user: applicant, ticketId: id, body: { accepted: false, remarks: 'Still leaks' } })).status, 200);
  assert.equal(await statusOf(id), 'WORK_IN_PROGRESS');
  assert.equal((await liveReminders(id)).length, 0, 'dispute stops the reminders');

  await call(updateTenderStatus, { user: je, ticketId: id, body: { milestone: 'WORK_COMPLETED' } });
  assert.equal((await call(confirmCompletion, { user: applicant, ticketId: id, body: { accepted: true } })).status, 200);
  assert.equal(await statusOf(id), 'CLOSED');
  assert.equal((await liveReminders(id)).length, 0);

  const [log] = await pool.query('SELECT action FROM audit_logs WHERE ticket_id = ? ORDER BY id', [id]);
  assert.deepEqual(log.map((r) => r.action), ['WORK_COMPLETED', 'REMINDER_SENT', 'WORK_REOPENED', 'WORK_COMPLETED', 'CLOSED']);
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

  await pool.query("UPDATE tickets SET status = 'CLOSED' WHERE id = ?", [id]);
  assert.equal((await up({ id: seId, role: 'SE' })).status, 403);

  fs.rmSync(path.resolve('uploads/tickets', String(id)), { recursive: true, force: true });
});
