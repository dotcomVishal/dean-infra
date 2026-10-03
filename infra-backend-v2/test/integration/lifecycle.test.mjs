// Master plan section 7 through the real routes: tender lifecycle, resolve at any stage, the confirmer,
// send-back to where it was resolved from, the two sections, daily reminders and auto-close.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import app from '../../src/app.js';
import { auth } from '../../src/config/firebase.js';
import { STATUS, RESOLVABLE_STATUSES, deskForStatus, AUTO_CLOSE_DAYS } from '../../src/config/workflow.js';
import { resolveDeskOwner } from '../../src/models/deskModel.js';
import { autoCloseResolved, processDueNotifications } from '../../src/cron/emailReminders.js';
import { makeUser, makeOpenTicket, cleanup, pool } from './helpers.mjs';

const DAY = 24 * 3600 * 1000;
let server;
let base;
before(async () => {
  auth.verifyIdToken = async (token) => ({
    uid: token, email: `${token}@test.local`, email_verified: true, firebase: { sign_in_provider: 'google.com' },
  });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(cleanup);
after(async () => { await cleanup(); server.close(); await pool.end(); });

const uidOf = async (id) => (await pool.query('SELECT firebase_uid FROM infra_users WHERE id = ?', [id]))[0][0].firebase_uid;
async function http(token, method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const row = async (id) => (await pool.query('SELECT * FROM infra_tickets WHERE id = ?', [id]))[0][0];

/** Applicant, JE, AE, SE and a ticket at `status` with the AE and SE pinned. */
async function setup(status = 'WORK_IN_PROGRESS', { jeRaised = false } = {}) {
  const je = await makeUser({ role: 'JE' });
  const applicant = jeRaised ? je : await makeUser({ role: 'APPLICANT' });
  const ae = await makeUser({ role: 'AE' });
  const se = await makeUser({ role: 'SE' });
  const ticketId = await makeOpenTicket(applicant, je, status);
  const desk = deskForStatus(status);
  const holder = { JE: je, AE: ae, SE: se }[desk] ?? null;
  await pool.query(
    'UPDATE infra_tickets SET assigned_ae_id = ?, assigned_se_id = ?, current_desk_user_id = ?, status_changed_at = NOW() WHERE id = ?',
    [ae, se, holder, ticketId]);
  const other = await makeUser({ role: 'JE' });
  return {
    ticketId, ids: { je, applicant, ae, se },
    t: { je: await uidOf(je), applicant: await uidOf(applicant), ae: await uidOf(ae), other: await uidOf(other) },
  };
}
const life = (token, ticketId, body) => http(token, 'POST', `/api/tickets/${ticketId}/lifecycle`, body);
const confirm = (token, ticketId, body) => http(token, 'POST', `/api/tickets/${ticketId}/confirm-completion`, body);
const liveReminders = async (id) => (await pool.query(
  "SELECT desk, to_user_id FROM infra_notifications WHERE ticket_id = ? AND kind = 'REMINDER' AND status = 'PENDING'", [id]))[0];

test('happy path: publish, technical, financial, award, resolve, confirm', async () => {
  const { ticketId, ids, t } = await setup('APPROVED_FOR_TENDERING');
  const step = async (body, expected) => {
    const r = await life(t.je, ticketId, body);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await row(ticketId)).status, expected);
    assert.ok((await row(ticketId)).status_changed_at, 'status_changed_at is set on every step');
  };
  await step({ action: 'PUBLISH_TENDER', tender_created_date: '2026-10-01', tender_end_date: '2026-10-20', nit_number: 'NIT-1' }, 'TENDER_PUBLISHED');
  await step({ action: 'START_TECHNICAL_EVAL' }, 'TECHNICAL_EVALUATION');
  await step({ action: 'START_FINANCIAL_EVAL' }, 'FINANCIAL_EVALUATION');
  await step({ action: 'AWARD', award_amount: '125000.50', awarded_agency: 'ABC Constructions' }, 'WORK_IN_PROGRESS');

  const [[tender]] = await pool.query('SELECT * FROM infra_tenders WHERE ticket_id = ?', [ticketId]);
  assert.equal(tender.status, 'AWARDED');
  assert.equal(Number(tender.award_amount), 125000.5);
  assert.equal(tender.awarded_agency, 'ABC Constructions');
  assert.ok(tender.technical_eval_at && tender.financial_eval_at && tender.awarded_at);
  assert.equal(tender.nit_number, 'NIT-1');
  assert.equal((await pool.query('SELECT COUNT(*) AS n FROM infra_notifications WHERE ticket_id = ?', [ticketId]))[0][0].n, 0, 'tender steps mail nobody');

  await step({ action: 'RESOLVE' }, 'WORK_COMPLETED');
  const r = await row(ticketId);
  assert.equal(r.resolution_kind, 'COMPLETED');
  assert.equal(r.resolved_from_status, 'WORK_IN_PROGRESS');
  assert.equal(r.current_desk_user_id, ids.applicant, 'the person who raised it confirms');
  assert.deepEqual(await liveReminders(ticketId), [{ desk: 'APPLICANT', to_user_id: ids.applicant }]);

  assert.equal((await confirm(t.je, ticketId, { accepted: true })).status, 404, 'the JE is not the confirmer');
  const closed = await confirm(t.applicant, ticketId, { accepted: true });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  const c = await row(ticketId);
  assert.equal(c.status, 'CLOSED');
  assert.ok(c.closed_at && c.status_changed_at);
  assert.equal(c.current_desk_user_id, null);
  assert.deepEqual(await liveReminders(ticketId), []);
  const [log] = await pool.query('SELECT action FROM infra_audit_logs WHERE ticket_id = ? ORDER BY id', [ticketId]);
  assert.deepEqual(log.map((l) => l.action),
    ['TENDER_PUBLISHED', 'TECH_EVAL_STARTED', 'FIN_EVAL_STARTED', 'WORK_AWARDED', 'RESOLVED', 'CLOSED']);
});

test('refusals: award without an amount, skipping a step, a stranger JE, a bad date', async () => {
  const { ticketId, t } = await setup('FINANCIAL_EVALUATION');
  const noAmount = await life(t.je, ticketId, { action: 'AWARD', awarded_agency: 'X' });
  assert.equal(noAmount.status, 400);
  assert.equal(noAmount.body.code, 'AWARD_AMOUNT_REQUIRED');
  assert.equal((await row(ticketId)).status, 'FINANCIAL_EVALUATION', 'nothing changed');

  const skip = await life(t.je, ticketId, { action: 'PUBLISH_TENDER', tender_created_date: '2026-10-01', tender_end_date: '2026-10-02' });
  assert.equal(skip.status, 409);
  assert.equal((await life(t.other, ticketId, { action: 'RESOLVE', note: 'x' })).status, 404, 'another JE cannot act');
  assert.equal((await life(t.ae, ticketId, { action: 'RESOLVE', note: 'x' })).status, 403, 'an AE is not a JE (route role gate)');
  assert.equal((await life(t.je, ticketId, { action: 'DANCE' })).status, 400);
  assert.equal((await pool.query('SELECT COUNT(*) AS n FROM infra_audit_logs WHERE ticket_id = ?', [ticketId]))[0][0].n, 0);
});

test('cancel: resolves as TENDER_CANCELLED, no send-back, acknowledge closes, applicant sees the plain label', async () => {
  const { ticketId, ids, t } = await setup('TENDER_PUBLISHED');
  assert.equal((await life(t.je, ticketId, { action: 'CANCEL_TENDER' })).status, 400, 'reason is mandatory');
  const c = await life(t.je, ticketId, { action: 'CANCEL_TENDER', reason: 'No bids received' });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const r = await row(ticketId);
  assert.equal(r.status, 'WORK_COMPLETED');
  assert.equal(r.resolution_kind, 'TENDER_CANCELLED');
  assert.equal(r.current_desk_user_id, ids.applicant);
  const [[tender]] = await pool.query('SELECT status, cancel_reason FROM infra_tenders WHERE ticket_id = ?', [ticketId]);
  assert.deepEqual([tender.status, tender.cancel_reason], ['CANCELLED', 'No bids received']);

  const d = await http(t.applicant, 'GET', `/api/tickets/${ticketId}/details`);
  assert.equal(d.body.ticket.stage_label, 'Tender cancelled — please acknowledge');
  assert.equal(d.body.ticket.confirmation.can_send_back, false);
  assert.ok(d.body.ticket.messages.some((m) => m.body === 'No bids received'), 'the confirmer sees the reason');

  const back = await confirm(t.applicant, ticketId, { accepted: false, remarks: 'Redo it' });
  assert.equal(back.status, 409);
  assert.equal(back.body.code, 'SEND_BACK_NOT_ALLOWED');
  assert.equal((await confirm(t.applicant, ticketId, { accepted: true })).status, 200);
  assert.equal((await row(ticketId)).status, 'CLOSED');
});

test('resolve from every open status; send-back returns to exactly that status with the right holder', async () => {
  for (const status of RESOLVABLE_STATUSES) {
    await cleanup();
    const { ticketId, ids, t } = await setup(status);
    const needsReason = status !== 'WORK_IN_PROGRESS';
    if (needsReason) assert.equal((await life(t.je, ticketId, { action: 'RESOLVE' })).status, 400, `${status} needs a reason`);
    const res = await life(t.je, ticketId, { action: 'RESOLVE', note: needsReason ? 'Handled on site' : undefined });
    assert.equal(res.status, 200, `${status}: ${JSON.stringify(res.body)}`);
    let r = await row(ticketId);
    assert.equal(r.status, 'WORK_COMPLETED');
    assert.equal(r.resolved_from_status, status);
    assert.equal(r.resolution_kind, needsReason ? 'OVERRIDE' : 'COMPLETED');

    const noComment = await confirm(t.applicant, ticketId, { accepted: false });
    assert.equal(noComment.status, 400);
    const sent = await confirm(t.applicant, ticketId, { accepted: false, remarks: 'Not resolved' });
    assert.equal(sent.status, 200, `${status}: ${JSON.stringify(sent.body)}`);
    r = await row(ticketId);
    assert.equal(r.status, status, 'back to exactly where it was resolved from');
    assert.ok(r.applicant_sent_back_at);
    assert.equal(r.reopen_count, 1);
    const desk = deskForStatus(status);
    const expected = desk ? (await resolveDeskOwner(pool, r, desk))?.id : null;
    assert.equal(r.current_desk_user_id, expected ?? null, `${status}: holder`);
    assert.ok(ids.je);
  }
});

test('a JE-raised ticket is confirmed by its AE, with one mail and no daily series', async () => {
  const { ticketId, ids, t } = await setup('WORK_IN_PROGRESS', { jeRaised: true });
  assert.equal((await life(t.je, ticketId, { action: 'RESOLVE' })).status, 200);
  assert.equal((await row(ticketId)).current_desk_user_id, ids.ae);
  const [mail] = await pool.query('SELECT kind, to_user_id FROM infra_notifications WHERE ticket_id = ?', [ticketId]);
  assert.deepEqual(mail, [{ kind: 'EMAIL', to_user_id: ids.ae }]);

  const d = await http(t.ae, 'GET', `/api/tickets/${ticketId}/details`);
  assert.equal(d.body.ticket.confirmation.can_confirm, true, 'the confirm panel is offered on the staff page too');
  assert.equal((await confirm(t.je, ticketId, { accepted: true })).status, 404, 'the JE who raised it cannot confirm');
  const board = await http(t.ae, 'GET', '/api/tickets/desk');
  assert.ok(board.body.my_desk.some((x) => x.id === ticketId), 'it is on the AE\'s desk');
  assert.equal((await confirm(t.ae, ticketId, { accepted: true })).status, 200);
  assert.equal((await row(ticketId)).status, 'CLOSED');
});

test('a double submit gives one success and one 409', async () => {
  const { ticketId, t } = await setup('WORK_IN_PROGRESS');
  const [a, b] = await Promise.all([life(t.je, ticketId, { action: 'RESOLVE' }), life(t.je, ticketId, { action: 'RESOLVE' })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal((await pool.query("SELECT COUNT(*) AS n FROM infra_audit_logs WHERE ticket_id = ? AND action = 'RESOLVED'", [ticketId]))[0][0].n, 1);
});

test('the two sections: resolved awaiting confirmation, and sent back with the comment and count', async () => {
  const { ticketId, t } = await setup('WORK_IN_PROGRESS');
  await life(t.je, ticketId, { action: 'RESOLVE' });
  let board = await http(t.je, 'GET', '/api/tickets/desk');
  assert.ok(board.body.awaiting_confirmation.some((x) => x.id === ticketId));
  assert.equal(board.body.sent_back.length, 0);
  const mine = await http(t.applicant, 'GET', '/api/tickets/desk');
  assert.equal(mine.body.my_tickets[0].id, ticketId);
  assert.equal(mine.body.my_tickets[0].needs_confirmation, true);

  await confirm(t.applicant, ticketId, { accepted: false, remarks: 'Still leaks' });
  board = await http(t.je, 'GET', '/api/tickets/desk');
  assert.equal(board.body.awaiting_confirmation.length, 0);
  const sb = board.body.sent_back.find((x) => x.id === ticketId);
  assert.ok(sb);
  assert.equal(sb.sent_back_comment, 'Still leaks');
  assert.equal(sb.reopen_count, 1);
  const ae = await http(t.ae, 'GET', '/api/tickets/desk');
  assert.ok(ae.body.sent_back.some((x) => x.id === ticketId), 'the AE sees it too');
});

test('applicant mail: resolve mail at once, one a day, seven in all, then the auto-close mail, then nothing', async () => {
  const { ticketId, ids, t } = await setup('WORK_IN_PROGRESS');
  await life(t.je, ticketId, { action: 'RESOLVE' });
  const [[{ resolved_at }]] = await pool.query('SELECT resolved_at FROM infra_tickets WHERE id = ?', [ticketId]);
  const sent = [];
  const send = async (m) => { sent.push(m); };
  const day = (n, extraMin = 1) => new Date(new Date(resolved_at).getTime() + n * DAY + extraMin * 60_000);

  for (let n = 0; n < AUTO_CLOSE_DAYS; n += 1) {
    await processDueNotifications({ now: day(n), send });
    await processDueNotifications({ now: day(n, 30), send }); // a second pass the same day sends nothing new
    assert.equal(sent.length, n + 1, `after day ${n}`);
  }
  assert.ok(/resolved: please confirm/.test(sent[0].subject));
  assert.deepEqual(await liveReminders(ticketId), [], 'the series ended itself after seven mails');

  assert.deepEqual(await autoCloseResolved({ now: day(AUTO_CLOSE_DAYS - 1, 1439) }), [], 'not before 7 days');
  assert.deepEqual(await autoCloseResolved({ now: day(AUTO_CLOSE_DAYS, 0) }), [ticketId], 'at 7 days');
  await processDueNotifications({ now: day(AUTO_CLOSE_DAYS, 2), send });
  assert.equal(sent.length, AUTO_CLOSE_DAYS + 1);
  assert.ok(/closed automatically/.test(sent.at(-1).subject));
  await processDueNotifications({ now: day(AUTO_CLOSE_DAYS + 3), send });
  assert.equal(sent.length, AUTO_CLOSE_DAYS + 1, 'nothing after that');

  const r = await row(ticketId);
  assert.equal(r.status, 'CLOSED');
  assert.ok(r.closed_at);
  const [[a]] = await pool.query("SELECT user_id FROM infra_audit_logs WHERE ticket_id = ? AND action = 'AUTO_CLOSED'", [ticketId]);
  assert.equal(a.user_id, ids.applicant, 'recorded against the confirmer');
});

test('auto-close skips test tickets and tickets answered meanwhile; each new resolve restarts the 7 days', async () => {
  const mock = await setup('WORK_IN_PROGRESS');
  await life(mock.t.je, mock.ticketId, { action: 'RESOLVE' });
  await pool.query('UPDATE infra_tickets SET is_mock = TRUE, resolved_at = NOW() - INTERVAL 30 DAY WHERE id = ?', [mock.ticketId]);
  const sb = await setup('WORK_IN_PROGRESS');
  await life(sb.t.je, sb.ticketId, { action: 'RESOLVE' });
  await pool.query('UPDATE infra_tickets SET resolved_at = NOW() - INTERVAL 6 DAY WHERE id = ?', [sb.ticketId]);
  await confirm(sb.t.applicant, sb.ticketId, { accepted: false, remarks: 'Not done' });
  await life(sb.t.je, sb.ticketId, { action: 'RESOLVE' }); // resolved again: the clock restarts
  assert.deepEqual(await autoCloseResolved({ now: new Date(Date.now() + 2 * DAY) }), []);
  assert.equal((await row(mock.ticketId)).status, 'WORK_COMPLETED');
  assert.equal((await row(sb.ticketId)).status, 'WORK_COMPLETED');
  assert.equal((await row(sb.ticketId)).applicant_sent_back_at, null, 'cleared on the next resolve');
});

test('files travel with a resolve as work documents, linked to the timeline entry', async () => {
  const { ticketId, t } = await setup('WORK_IN_PROGRESS');
  const fd = new FormData();
  fd.append('action', 'RESOLVE');
  fd.append('files', new Blob([Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)])], { type: 'image/jpeg' }), 'done.jpg');
  const res = await fetch(`${base}/api/tickets/${ticketId}/lifecycle`, { method: 'POST', headers: { Authorization: `Bearer ${t.je}` }, body: fd });
  assert.equal(res.status, 200, await res.text());
  const [[att]] = await pool.query(
    "SELECT a.document_category, a.uploader_desk, l.action FROM infra_attachments a JOIN infra_audit_logs l ON l.id = a.audit_log_id WHERE a.ticket_id = ?", [ticketId]);
  assert.deepEqual([att.document_category, att.uploader_desk, att.action], ['WORK_DOC', 'JE', 'RESOLVED']);
});

test('upload category comes from the uploader; outsiders and closed tickets are refused', async () => {
  const { ticketId, ids, t } = await setup('PENDING_SE_APPROVAL');
  const seTok = await uidOf(ids.se);
  const f = () => { const fd = new FormData(); fd.append('files', new Blob([Buffer.from('%PDF-1.4 ci')], { type: 'application/pdf' }), 'q.pdf'); return fd; };
  const up = (tok) => fetch(`${base}/api/tickets/${ticketId}/attachments`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: f() })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
  assert.equal((await up(seTok)).body.category, 'DESK_DOC');
  assert.equal((await up(t.applicant)).body.category, 'APPLICANT_EVIDENCE');
  assert.equal((await up(t.other)).status, 403);
  await pool.query("UPDATE infra_tickets SET status = 'CLOSED' WHERE id = ?", [ticketId]);
  assert.equal((await up(seTok)).status, 403);
});
