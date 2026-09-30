// plan2.md Phase 2 against a real MySQL: pinned AE/SE holders, Sysadmin
// reassignment, self-action flag, single-holder health, mock-ticket isolation,
// placeholder mail guard.
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { findDeskOwner, loadAssignees, resolveAeForScope } from '../../src/models/deskModel.js';
import { pickAvailableJe } from '../../src/services/assignment.js';
import { performTicketAction, pinsFor, isSelfAction } from '../../src/controllers/actionController.js';
import { overrideTicketStatus, getStaff, getAdminMetrics, getMasterAuditLogs } from '../../src/controllers/adminController.js';
import { getQueue } from '../../src/controllers/ticketController.js';
import { notifyTicketCreated } from '../../src/services/notifier.js';
import { checkSingleHolders } from '../../src/services/deskHealth.js';
import { processDueNotifications } from '../../src/cron/emailReminders.js';
import { DEPT, makeUser, makeOpenTicket, inRolledBackTx, cleanup, pool } from './helpers.mjs';

beforeEach(cleanup);
after(async () => { await cleanup(); await pool.end(); });

const fakeRes = () => {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const civilScope = (userId, campus = 'NORTH') =>
  pool.query("INSERT INTO user_scopes (user_id, department, campus) VALUES (?, 'Civil', ?)", [userId, campus]);
const userRow = async (id) => (await pool.query('SELECT id, name, email, role FROM users WHERE id = ?', [id]))[0][0];
const ticketRow = async (id) => (await pool.query('SELECT * FROM tickets WHERE id = ?', [id]))[0][0];
const patch = (id, fields) => pool.query('UPDATE tickets SET ? WHERE id = ?', [fields, id]);
const auditFor = async (id) => (await pool.query('SELECT * FROM audit_logs WHERE ticket_id = ? ORDER BY id', [id]))[0];
const act = async (user, ticketId, body) => {
  const res = fakeRes();
  await performTicketAction({ user: { ...user }, params: { ticket_id: String(ticketId) }, body }, res);
  return res;
};
const override = async (admin, ticketId, body) => {
  const res = fakeRes();
  await overrideTicketStatus({ user: { id: admin, name: 'CI Admin' }, params: { ticket_id: String(ticketId) }, body }, res);
  return res;
};

// A ticket waiting at the AE desk, held by `ae`.
async function ticketAtAe({ applicant, ae, pinned = true }) {
  const je = await makeUser({ role: 'JE' });
  const id = await makeOpenTicket(applicant, je, 'PENDING_AE_APPROVAL');
  await patch(id, { current_desk_user_id: ae, ...(pinned ? { assigned_ae_id: ae } : {}) });
  return id;
}

// ---- deskModel ---------------------------------------------------------------------------------
test('pinned AE wins over the scope AE', async () => {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const scopeAe = await makeUser({ role: 'AE' }); await civilScope(scopeAe);
  const pinnedAe = await makeUser({ role: 'AE' });
  const id = await ticketAtAe({ applicant, ae: pinnedAe });
  assert.equal((await findDeskOwner(pool, await ticketRow(id), 'AE')).id, pinnedAe);
});

test('inactive or wrong-role pin falls back to scope resolution', async () => {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const scopeAe = await makeUser({ role: 'AE' }); await civilScope(scopeAe);
  const pinnedAe = await makeUser({ role: 'AE' });
  const id = await ticketAtAe({ applicant, ae: pinnedAe });
  await pool.query('UPDATE users SET is_active = FALSE WHERE id = ?', [pinnedAe]);
  // Seeded staff in a dev DB may also cover Civil/NORTH: compare with the scope rule itself.
  const byScope = (await resolveAeForScope(pool, { department: 'Civil', campus: 'NORTH' })).id;
  assert.equal((await findDeskOwner(pool, await ticketRow(id), 'AE')).id, byScope);

  const se = await makeUser({ role: 'SE' });
  await patch(id, { assigned_ae_id: se });
  const owner = await findDeskOwner(pool, await ticketRow(id), 'AE');
  assert.equal(owner.id, byScope);
  assert.equal(owner.role, 'AE');
});

test('pinned SE wins', async () => {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const se = await makeUser({ role: 'SE' });
  await makeUser({ role: 'SE' });
  const id = await makeOpenTicket(applicant, null, 'PENDING_SE_APPROVAL');
  await patch(id, { assigned_se_id: se });
  assert.equal((await findDeskOwner(pool, await ticketRow(id), 'SE')).id, se);
});

test('a mock ticket resolves every desk to its creator', async () => {
  const admin = await makeUser({ role: 'SYSADMIN' });
  const id = await makeOpenTicket(admin, admin, 'PENDING_SE_APPROVAL');
  await patch(id, { is_mock: 1 });
  const row = await ticketRow(id);
  for (const d of ['JE', 'AE', 'SE', 'DEAN', 'DIRECTOR']) assert.equal((await findDeskOwner(pool, row, d)).id, admin, d);
});

test('pinsFor pins only when the owner really holds that desk', () => {
  assert.deepEqual(pinsFor('AE', { id: 5, role: 'AE' }), { assignedAeId: 5 });
  assert.deepEqual(pinsFor('SE', { id: 6, role: 'SE' }), { assignedSeId: 6 });
  assert.deepEqual(pinsFor('AE', { id: 7, role: 'SYSADMIN' }), {});
  assert.deepEqual(pinsFor('DEAN', { id: 8, role: 'DEAN' }), {});
  assert.deepEqual(pinsFor('AE', null), {});
});

test('isSelfAction is false on mock tickets', () => {
  assert.equal(isSelfAction({ applicant_id: 1, is_mock: 0 }, 1), true);
  assert.equal(isSelfAction({ applicant_id: 1, is_mock: 1 }, 1), false);
  assert.equal(isSelfAction({ applicant_id: 1, is_mock: 0 }, 2), false);
});

// ---- transitions pin and flag ----------------------------------------------------------------------
test('forwarding pins the SE and flags nothing when the actor did not raise the ticket', async () => {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const ae = await makeUser({ role: 'AE' });
  await makeUser({ role: 'SE' });
  const id = await ticketAtAe({ applicant, ae });
  const res = await act({ id: ae, role: 'AE', name: 'AE' }, id, { action: 'FORWARD' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const row = await ticketRow(id);
  assert.equal(row.status, 'PENDING_SE_APPROVAL');
  assert.equal(row.assigned_se_id, row.current_desk_user_id);
  assert.equal((await userRow(row.assigned_se_id)).role, 'SE');
  assert.equal((await auditFor(id)).at(-1).is_self_action, 0);
});

test('an AE forwarding a ticket they raised is allowed and flagged', async () => {
  const ae = await makeUser({ role: 'AE' });
  await makeUser({ role: 'SE' });
  const id = await ticketAtAe({ applicant: ae, ae });
  const res = await act({ id: ae, role: 'AE', name: 'AE' }, id, { action: 'FORWARD' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const last = (await auditFor(id)).at(-1);
  assert.equal(last.action, 'FORWARDED');
  assert.equal(last.is_self_action, 1);
});

// ---- Sysadmin override --------------------------------------------------------------------------------------
test('reassigning the AE hands the ticket over: new AE can act, old AE cannot', async () => {
  const admin = await makeUser({ role: 'SYSADMIN' });
  const applicant = await makeUser({ role: 'APPLICANT' });
  const ae1 = await makeUser({ role: 'AE' });
  const ae2 = await makeUser({ role: 'AE' });
  await makeUser({ role: 'SE' });
  const id = await ticketAtAe({ applicant, ae: ae1 });

  const res = await override(admin, id, { remarks: 'ae on leave', reassign: { desk: 'AE', user_id: ae2 } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const row = await ticketRow(id);
  assert.equal(row.assigned_ae_id, ae2);
  assert.equal(row.current_desk_user_id, ae2);
  assert.equal(row.status, 'PENDING_AE_APPROVAL');

  const audit = (await auditFor(id)).at(-1);
  assert.equal(audit.action, 'REASSIGNED');
  assert.equal(audit.from_desk, 'AE');
  assert.equal(audit.to_desk, 'AE');
  assert.equal(audit.user_id, admin);

  const old = await act({ id: ae1, role: 'AE', name: 'old' }, id, { action: 'FORWARD' });
  assert.notEqual(old.statusCode, 200);
  const fresh = await act({ id: ae2, role: 'AE', name: 'new' }, id, { action: 'FORWARD' });
  assert.equal(fresh.statusCode, 200, JSON.stringify(fresh.body));
});

test('reassigning a desk the ticket is not at pins the holder without moving the ticket', async () => {
  const admin = await makeUser({ role: 'SYSADMIN' });
  const applicant = await makeUser({ role: 'APPLICANT' });
  const ae = await makeUser({ role: 'AE' });
  const se = await makeUser({ role: 'SE' });
  const id = await ticketAtAe({ applicant, ae });
  const res = await override(admin, id, { remarks: 'pre-assign', reassign: { desk: 'SE', user_id: se } });
  assert.equal(res.statusCode, 200);
  const row = await ticketRow(id);
  assert.equal(row.assigned_se_id, se);
  assert.equal(row.current_desk_user_id, ae);
});

test('Dean reassignment at the Dean desk writes current_desk_user_id only', async () => {
  const admin = await makeUser({ role: 'SYSADMIN' });
  const applicant = await makeUser({ role: 'APPLICANT' });
  const dean = await makeUser({ role: 'DEAN' });
  const id = await makeOpenTicket(applicant, null, 'PENDING_DEAN_APPROVAL');
  const res = await override(admin, id, { remarks: 'stand-in', reassign: { desk: 'DEAN', user_id: dean } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal((await ticketRow(id)).current_desk_user_id, dean);
});

test('a forced status recomputes the holder and pins the new AE/SE', async () => {
  const admin = await makeUser({ role: 'SYSADMIN' });
  const applicant = await makeUser({ role: 'APPLICANT' });
  const ae = await makeUser({ role: 'AE' });
  await makeUser({ role: 'SE' });
  const id = await ticketAtAe({ applicant, ae });
  const res = await override(admin, id, { remarks: 'skip ahead', new_status: 'PENDING_SE_APPROVAL' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const row = await ticketRow(id);
  assert.equal(row.status, 'PENDING_SE_APPROVAL');
  assert.equal((await userRow(row.current_desk_user_id)).role, 'SE');
  assert.equal(row.assigned_se_id, row.current_desk_user_id);

  const done = await override(admin, id, { remarks: 'approve', new_status: 'APPROVED_FOR_TENDERING' });
  assert.equal(done.statusCode, 200);
  assert.equal((await ticketRow(id)).current_desk_user_id, null);
});

test('legacy new_assigned_je_id reassigns the JE and hands over the JE desk', async () => {
  const admin = await makeUser({ role: 'SYSADMIN' });
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je1 = await makeUser({ role: 'JE' });
  const je2 = await makeUser({ role: 'JE' });
  const id = await makeOpenTicket(applicant, je1, 'ASSIGNED_TO_JE');
  await patch(id, { current_desk_user_id: je1 });
  const res = await override(admin, id, { remarks: 'rebalance', new_assigned_je_id: je2 });
  assert.equal(res.statusCode, 200);
  const row = await ticketRow(id);
  assert.equal(row.assigned_je_id, je2);
  assert.equal(row.current_desk_user_id, je2);
});

test('override rejects bad input with 400 and changes nothing', async () => {
  const admin = await makeUser({ role: 'SYSADMIN' });
  const applicant = await makeUser({ role: 'APPLICANT' });
  const ae = await makeUser({ role: 'AE' });
  const se = await makeUser({ role: 'SE' });
  const inactive = await makeUser({ role: 'AE' });
  await pool.query('UPDATE users SET is_active = FALSE WHERE id = ?', [inactive]);
  const id = await ticketAtAe({ applicant, ae });
  const before = await ticketRow(id);

  const bad = [
    { remarks: '', reassign: { desk: 'AE', user_id: ae } },
    { remarks: 'x', new_status: 'NOT_A_STATUS' },
    { remarks: 'x', reassign: { desk: 'AE', user_id: se } },        // wrong role
    { remarks: 'x', reassign: { desk: 'AE', user_id: inactive } },  // inactive
    { remarks: 'x', reassign: { desk: 'AE', user_id: 999999999 } }, // unknown
    { remarks: 'x', reassign: { desk: 'CLERICAL', user_id: ae } },  // not a chain desk
  ];
  for (const body of bad) {
    const res = await override(admin, id, body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
  assert.equal((await override(admin, 999999999, { remarks: 'x' })).statusCode, 404);
  assert.deepEqual(await ticketRow(id), before);
  assert.equal((await auditFor(id)).length, 0);
});

test('getStaff lists active users of one desk, scope match first', async () => {
  const other = await makeUser({ role: 'AE', name: 'CI other' });
  const match = await makeUser({ role: 'AE', name: 'CI match' }); await civilScope(match);
  const off = await makeUser({ role: 'AE' });
  await pool.query('UPDATE users SET is_active = FALSE WHERE id = ?', [off]);
  const res = fakeRes();
  await getStaff({ query: { role: 'AE', department: 'Civil', campus: 'NORTH' } }, res);
  const ids = res.body.staff.map((s) => s.id);
  assert.ok(ids.indexOf(match) < ids.indexOf(other));
  assert.equal(ids.includes(off), false);
  assert.equal(res.body.staff.find((s) => s.id === match).scope_match, true);

  const bad = fakeRes();
  await getStaff({ query: { role: 'CLERICAL' } }, bad);
  assert.equal(bad.statusCode, 400);
});

// ---- assignment: applicant ranked last ------------------------------------------------------------------------------
test('another available JE is chosen over the JE who raised the ticket', async () => {
  const raiser = await makeUser({ role: 'JE', campus: 'NORTH', scopes: ['NORTH'] });
  const other = await makeUser({ role: 'JE', campus: 'NORTH', scopes: ['NORTH'] });
  const pick = () => inRolledBackTx((c) => pickAvailableJe(c, { department: DEPT, campus: 'NORTH', applicantId: raiser }));
  assert.equal((await pick())?.id, other);
});

test('the JE who raised the ticket is chosen when they are the only one available', async () => {
  const raiser = await makeUser({ role: 'JE', campus: 'NORTH', scopes: ['NORTH'] });
  const pick = () => inRolledBackTx((c) => pickAvailableJe(c, { department: DEPT, campus: 'NORTH', applicantId: raiser }));
  assert.equal((await pick())?.id, raiser);
});

// ---- viewer payload -------------------------------------------------------------------------------------------------
test('assignees: full for staff, only the JE desk and the current desk for a JE', async () => {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const ae = await makeUser({ role: 'AE', name: 'CI Ann' });
  const id = await ticketAtAe({ applicant, ae });
  const row = await ticketRow(id);
  const full = await loadAssignees(pool, row, 'SYSADMIN');
  assert.equal(full.AE.id, ae);
  assert.deepEqual(full.current, { desk: 'AE', id: ae, name: 'CI Ann' });
  const je = await loadAssignees(pool, row, 'JE');
  assert.equal(je.AE, null);
  assert.deepEqual(je.current, { desk: 'AE' });
  assert.equal(JSON.stringify(je).includes('CI Ann'), false);
});

// ---- single-holder health --------------------------------------------------------------------------------------------
test('checkSingleHolders reports 0, 1, 2 holders and the placeholder state', async () => {
  await inRolledBackTx(async (c) => {
    await c.query("UPDATE users SET is_active = FALSE WHERE role = 'DEAN'");
    let h = await checkSingleHolders(c);
    assert.equal(h.DEAN.count, 0);
    assert.equal(h.DEAN.ok, false);

    const add = (email) => c.query(
      `INSERT INTO users (firebase_uid, name, email, role, department, is_active)
       VALUES (?, 'CI Dean', ?, 'DEAN', 'Administration', TRUE)`, [randomUUID(), email]);
    await add('ph-ci@placeholder.invalid');
    h = await checkSingleHolders(c);
    assert.deepEqual([h.DEAN.count, h.DEAN.placeholder, h.DEAN.ok], [1, true, false]);

    await add(`real-${randomUUID().slice(0, 6)}@test.local`);
    h = await checkSingleHolders(c);
    assert.equal(h.DEAN.count, 2);
    assert.equal(h.DEAN.placeholder, false);
    assert.match(h.DEAN.message, /Deactivate all but one/);

    await c.query("UPDATE users SET is_active = FALSE WHERE email = 'ph-ci@placeholder.invalid'");
    h = await checkSingleHolders(c);
    assert.deepEqual([h.DEAN.count, h.DEAN.ok, h.DEAN.message], [1, true, null]);
  });
});

// ---- mail ------------------------------------------------------------------------------------------------------------------
test('mail to a .invalid placeholder is cancelled, never sent or retried', async () => {
  const email = `ph-${randomUUID().slice(0, 6)}@placeholder.invalid`;
  const [u] = await pool.query(
    `INSERT INTO users (firebase_uid, name, email, role, department, is_active)
     VALUES (?, 'Placeholder', ?, 'DEAN', 'Administration', TRUE)`, [randomUUID(), email]);
  const [n] = await pool.query(
    `INSERT INTO notifications (to_user_id, kind, subject, body, next_due_at) VALUES (?, 'EMAIL', 's', 'b', NOW() - INTERVAL 1 MINUTE)`,
    [u.insertId]);
  try {
    const sent = [];
    const tally = await processDueNotifications({ send: async (m) => { sent.push(m); } });
    assert.deepEqual(sent, []);
    assert.ok(tally.cancelled >= 1);
    const [[row]] = await pool.query('SELECT status, last_error, attempts FROM notifications WHERE id = ?', [n.insertId]);
    assert.deepEqual([row.status, row.last_error, row.attempts], ['CANCELLED', 'placeholder address', 0]);
  } finally {
    await pool.query('DELETE FROM notifications WHERE to_user_id = ?', [u.insertId]);
    await pool.query('DELETE FROM users WHERE id = ?', [u.insertId]);
  }
});

// ---- mock isolation --------------------------------------------------------------------------------------------------------
test('a mock ticket sends no mail and is absent from queues, metrics and the audit stream', async () => {
  const admin = await makeUser({ role: 'SYSADMIN' });
  const id = await makeOpenTicket(admin, admin, 'ASSIGNED_TO_JE');
  await patch(id, { is_mock: 1, current_desk_user_id: admin });
  await pool.query(
    "INSERT INTO audit_logs (ticket_id, user_id, action, remarks, is_self_action) VALUES (?, ?, 'CREATED', 'mock', 1)", [id, admin]);

  const deskUser = await userRow(admin);
  await inRolledBackTx((c) => notifyTicketCreated(c, {
    ticketId: id,
    assignment: { status: 'ASSIGNED_TO_JE', assignedJeId: admin, currentDeskUserId: admin, deskUser },
  }));
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM notifications WHERE ticket_id = ?', [id]);
  assert.equal(n, 0);

  const q = fakeRes();
  await getQueue({ user: { id: admin, role: 'SYSADMIN', department: 'Administration' }, query: { limit: '200' } }, q);
  assert.equal(q.body.tickets.some((t) => t.id === id), false);

  const m = fakeRes();
  await getAdminMetrics({}, m);
  const [[{ n_real }]] = await pool.query('SELECT COUNT(*) AS n_real FROM tickets WHERE is_mock = FALSE');
  assert.equal(m.body.metrics.totalTickets, n_real);
  assert.ok(m.body.desk_health.DEAN);

  const a = fakeRes();
  await getMasterAuditLogs({ query: { ticket_id: String(id) } }, a);
  assert.equal(a.body.logs.length, 0);
  const b = fakeRes();
  await getMasterAuditLogs({ query: { ticket_id: String(id), include_mock: '1', self_only: '1' } }, b);
  assert.equal(b.body.logs.length, 1);
  assert.equal(b.body.logs[0].is_self_action, 1);
});

test('self_only returns only flagged audit rows', async () => {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const ae = await makeUser({ role: 'AE' });
  const id = await ticketAtAe({ applicant, ae });
  await pool.query("INSERT INTO audit_logs (ticket_id, user_id, action, is_self_action) VALUES (?, ?, 'FORWARDED', 1), (?, ?, 'APPROVED', 0)",
    [id, ae, id, ae]);
  const res = fakeRes();
  await getMasterAuditLogs({ query: { ticket_id: String(id), self_only: '1' } }, res);
  assert.deepEqual(res.body.logs.map((l) => l.action), ['FORWARDED']);
});
