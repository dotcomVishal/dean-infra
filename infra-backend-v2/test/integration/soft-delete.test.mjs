// Master plan section 9: the Sysadmin hides a real ticket and can restore it; nobody else can reach it.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import app from '../../src/app.js';
import { auth } from '../../src/config/firebase.js';
import { autoCloseResolved, processDueNotifications } from '../../src/cron/emailReminders.js';
import { makeUser, makeOpenTicket, cleanup, pool } from './helpers.mjs';

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
after(async () => { await cleanup(); server.closeAllConnections?.(); server.close(); await pool.end(); });

const uidOf = async (id) => (await pool.query('SELECT firebase_uid FROM infra_users WHERE id = ?', [id]))[0][0].firebase_uid;
async function http(token, method, url, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(base + url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const row = async (id) => (await pool.query('SELECT * FROM infra_tickets WHERE id = ?', [id]))[0][0];
const REASON = 'Duplicate of another ticket, raised twice by mistake';

async function setup(status = 'PENDING_AE_APPROVAL') {
  const admin = await makeUser({ role: 'SYSADMIN' });
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je = await makeUser({ role: 'JE' });
  const ae = await makeUser({ role: 'AE' });
  const ticketId = await makeOpenTicket(applicant, je, status);
  await pool.query('UPDATE infra_tickets SET assigned_ae_id = ?, current_desk_user_id = ? WHERE id = ?', [ae, ae, ticketId]);
  // a file, a report, a message and a pending reminder, to prove they survive
  const [att] = await pool.query(
    "INSERT INTO infra_attachments (ticket_id, file_url, uploaded_by, document_category) VALUES (?, '/uploads/x.pdf', ?, 'APPLICANT_EVIDENCE')", [ticketId, applicant]);
  await pool.query("INSERT INTO infra_reports (ticket_id, je_id, version, nature_of_work, estimated_amount) VALUES (?, ?, 1, 'Fix', 1000)", [ticketId, je]);
  await pool.query(
    "INSERT INTO infra_notifications (ticket_id, to_user_id, kind, audience, subject, body, next_due_at) VALUES (?, ?, 'EMAIL', 'STAFF', 's', 'b', NOW())", [ticketId, ae]);
  return {
    ticketId, attachmentId: att.insertId, ids: { admin, applicant, je, ae },
    t: { admin: await uidOf(admin), applicant: await uidOf(applicant), je: await uidOf(je), ae: await uidOf(ae) },
  };
}
const del = (token, id, body) => http(token, 'DELETE', `/api/admin/tickets/${id}`, body);

test('delete: validation, then hidden; restore brings everything back', async () => {
  const { ticketId, t } = await setup();
  assert.equal((await del(t.admin, ticketId, { confirm_ticket_id: '999', reason: REASON })).status, 400, 'wrong confirmation id');
  assert.equal((await del(t.admin, ticketId, { confirm_ticket_id: String(ticketId), reason: 'short' })).status, 400, 'reason too short');
  assert.equal((await del(t.admin, ticketId, { confirm_ticket_id: String(ticketId), reason: 'x'.repeat(1001) })).status, 400);
  assert.equal((await del(t.ae, ticketId, { confirm_ticket_id: String(ticketId), reason: REASON })).status, 403, 'a non-Sysadmin');
  assert.equal((await row(ticketId)).deleted_at, null);

  const ok = await del(t.admin, ticketId, { confirm_ticket_id: `TKT-${String(ticketId).padStart(4, '0')}`, reason: REASON });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const r = await row(ticketId);
  assert.ok(r.deleted_at && r.delete_reason === REASON && r.deleted_by);
  assert.equal((await del(t.admin, ticketId, { confirm_ticket_id: String(ticketId), reason: REASON })).status, 409, 'already deleted');
  const [[counts]] = await pool.query(
    'SELECT (SELECT COUNT(*) FROM infra_attachments WHERE ticket_id = ?) AS f, (SELECT COUNT(*) FROM infra_reports WHERE ticket_id = ?) AS r', [ticketId, ticketId]);
  assert.deepEqual([counts.f, counts.r], [1, 1], 'nothing is removed');
  const [log] = await pool.query("SELECT action, remarks FROM infra_audit_logs WHERE ticket_id = ? ORDER BY id", [ticketId]);
  assert.deepEqual(log.map((l) => l.action), ['DELETED']);
  assert.match(log[0].remarks, /Duplicate of another ticket/);

  assert.equal((await http(t.admin, 'POST', `/api/admin/tickets/${ticketId}/restore`, {})).status, 400, 'restore needs a reason');
  assert.equal((await http(t.ae, 'POST', `/api/admin/tickets/${ticketId}/restore`, { reason: 'x' })).status, 403);
  const back = await http(t.admin, 'POST', `/api/admin/tickets/${ticketId}/restore`, { reason: 'Deleted by mistake' });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  const restored = await row(ticketId);
  assert.deepEqual([restored.deleted_at, restored.deleted_by, restored.delete_reason], [null, null, null]);
  assert.equal((await http(t.admin, 'POST', `/api/admin/tickets/${ticketId}/restore`, { reason: 'again' })).status, 409, 'not deleted');
  assert.equal((await http(t.ae, 'GET', `/api/tickets/${ticketId}/details`)).status, 200, 'visible again');
  const [log2] = await pool.query("SELECT action FROM infra_audit_logs WHERE ticket_id = ? ORDER BY id", [ticketId]);
  assert.deepEqual(log2.map((l) => l.action), ['DELETED', 'RESTORED']);
});

test('after a delete every non-admin endpoint for that id answers 404', async () => {
  const { ticketId, attachmentId, t } = await setup('ASSIGNED_TO_JE');
  assert.equal((await del(t.admin, ticketId, { confirm_ticket_id: String(ticketId), reason: REASON })).status, 200);
  const missing = await http(t.applicant, 'GET', '/api/tickets/99999999/details');
  assert.equal(missing.status, 404);

  const cases = [
    ['GET', `/api/tickets/${ticketId}/details`, t.ae],
    ['GET', `/api/tickets/${ticketId}/details`, t.applicant],
    ['GET', `/api/tickets/${ticketId}/details`, t.je],
    ['POST', `/api/tickets/${ticketId}/actions`, t.ae, { action: 'FORWARD' }],
    ['POST', `/api/tickets/${ticketId}/report`, t.je, new FormData()],
    ['POST', `/api/tickets/${ticketId}/lifecycle`, t.je, { action: 'RESOLVE', note: 'x' }],
    ['POST', `/api/tickets/${ticketId}/attachments`, t.applicant, new FormData()],
    ['POST', `/api/tickets/${ticketId}/confirm-completion`, t.applicant, { accepted: true }],
    ['GET', `/api/tickets/${ticketId}/assignable-jes`, t.ae],
    ['GET', `/api/attachments/${attachmentId}`, t.applicant],
    ['GET', `/api/attachments/${attachmentId}`, t.admin],
  ];
  for (const [method, url, token, body] of cases) {
    const r = await http(token, method, url, body);
    assert.equal(r.status, 404, `${method} ${url}: ${r.status}`);
  }
  // Even the Sysadmin gets 404 on the ordinary route; the admin route still shows it.
  assert.equal((await http(t.admin, 'GET', `/api/tickets/${ticketId}/details`)).status, 404);
  const adminView = await http(t.admin, 'GET', `/api/admin/tickets/${ticketId}/details`);
  assert.equal(adminView.status, 200);
  assert.ok(adminView.body.ticket.deleted_at);
  assert.deepEqual(adminView.body.ticket.counts, { reports: 1, files: 1, messages: 0 });
  assert.equal((await http(t.admin, 'POST', `/api/admin/tickets/${ticketId}/override`, { remarks: 'x', new_status: 'CLOSED' })).status, 409, 'override refuses a deleted ticket');
});

test('a deleted ticket is absent from every list, the JE load count and the metrics', async () => {
  const { ticketId, ids, t } = await setup('ASSIGNED_TO_JE');
  const idsIn = (b) => JSON.stringify(b);
  const before = await http(t.admin, 'GET', '/api/admin/metrics');
  assert.equal((await del(t.admin, ticketId, { confirm_ticket_id: String(ticketId), reason: REASON })).status, 200);

  const lists = [
    [t.applicant, '/api/tickets/applicant', (b) => b.tickets],
    [t.je, '/api/tickets/je/dashboard', (b) => b.tickets],
    [t.ae, '/api/tickets/queue?limit=200', (b) => b.tickets],
    [t.admin, '/api/admin/tickets?limit=200', (b) => b.tickets],
  ];
  for (const [token, url, pick] of lists) {
    const r = await http(token, 'GET', url);
    assert.equal(r.status, 200, url);
    assert.ok(!pick(r.body).some((x) => x.id === ticketId), `${url} still lists it`);
  }
  for (const token of [t.je, t.ae, t.applicant]) {
    const board = await http(token, 'GET', '/api/tickets/desk');
    assert.ok(!idsIn(board.body).includes(`"id":${ticketId},`), 'the desk board still lists it');
  }
  const withDeleted = await http(t.admin, 'GET', '/api/admin/tickets?limit=200&include_deleted=1');
  assert.ok(withDeleted.body.tickets.some((x) => x.id === ticketId && x.deleted_at), 'the Sysadmin can still show it');
  const after_ = await http(t.admin, 'GET', '/api/admin/metrics');
  assert.equal(after_.body.metrics.totalTickets, before.body.metrics.totalTickets - 1);
  const [[load]] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM infra_tickets x WHERE x.assigned_je_id = ? AND x.deleted_at IS NULL AND x.status IN ('ASSIGNED_TO_JE','RETURNED_TO_JE')) AS n`, [ids.je]);
  assert.equal(load.n, 0);
});

test('pending reminders are cancelled and none is sent; auto-close skips it; restore restarts the 7 days', async () => {
  const { ticketId, ids, t } = await setup('WORK_COMPLETED');
  await pool.query(
    "UPDATE infra_tickets SET current_desk_user_id = ?, resolution_kind = 'COMPLETED', resolved_from_status = 'WORK_IN_PROGRESS', resolved_at = NOW() - INTERVAL 30 DAY WHERE id = ?",
    [ids.applicant, ticketId]);
  await pool.query(
    "INSERT INTO infra_notifications (ticket_id, to_user_id, kind, audience, desk, subject, body, anchor_at, next_due_at, stop_when_status_not_in) VALUES (?, ?, 'REMINDER', 'APPLICANT', 'APPLICANT', 'Reminder', 'b', NOW(), NOW() - INTERVAL 1 MINUTE, 'WORK_COMPLETED')",
    [ticketId, ids.applicant]);
  assert.equal((await del(t.admin, ticketId, { confirm_ticket_id: String(ticketId), reason: REASON })).status, 200);
  const [pending] = await pool.query("SELECT id FROM infra_notifications WHERE ticket_id = ? AND status = 'PENDING'", [ticketId]);
  assert.equal(pending.length, 0, 'every pending mail of the ticket is cancelled');

  // A reminder claimed just before the delete is cancelled, not sent.
  await pool.query(
    "INSERT INTO infra_notifications (ticket_id, to_user_id, kind, audience, desk, subject, body, anchor_at, next_due_at, stop_when_status_not_in) VALUES (?, ?, 'REMINDER', 'APPLICANT', 'APPLICANT', 'Late reminder', 'b', NOW(), NOW() - INTERVAL 1 MINUTE, 'WORK_COMPLETED')",
    [ticketId, ids.applicant]);
  const sent = [];
  await processDueNotifications({ now: new Date(), send: async (m) => { sent.push(m); } });
  assert.ok(!sent.some((m) => /Late reminder/.test(m.subject)), 'a deleted ticket sends nothing');

  assert.deepEqual(await autoCloseResolved({ now: new Date() }), [], 'auto-close skips a deleted ticket');
  assert.equal((await row(ticketId)).status, 'WORK_COMPLETED');

  assert.equal((await http(t.admin, 'POST', `/api/admin/tickets/${ticketId}/restore`, { reason: 'mistake' })).status, 200);
  const r = await row(ticketId);
  assert.ok(Date.now() - new Date(r.resolved_at).getTime() < 60_000, 'the 7 days restart from the restore');
  assert.deepEqual(await autoCloseResolved({ now: new Date() }), []);
  assert.equal((await pool.query("SELECT COUNT(*) AS n FROM infra_notifications WHERE ticket_id = ? AND status = 'PENDING'", [ticketId]))[0][0].n, 0, 'reminders are not restarted');
});

test('test tickets keep their own endpoint: the real delete refuses them', async () => {
  const { ticketId, t } = await setup('ASSIGNED_TO_JE');
  await pool.query('UPDATE infra_tickets SET is_mock = TRUE WHERE id = ?', [ticketId]);
  const r = await del(t.admin, ticketId, { confirm_ticket_id: String(ticketId), reason: REASON });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'IS_TEST_TICKET');
  assert.equal((await del(t.admin, 99999999, { confirm_ticket_id: '99999999', reason: REASON })).status, 404);
});
