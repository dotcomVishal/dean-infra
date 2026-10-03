// plan2.md Phase 3c against a real MySQL: Sysadmin "act as" (X-Test-Role) on mock
// tickets. Drives the middleware and the real controllers with fake req/res, so it
// needs no Firebase key (CI has none).
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  testRoleForTicketParam, testRoleForAttachmentParam, rejectStrayTestRole, requireMockTesting, TEST_ROLES,
} from '../../src/middleware/testRole.js';
import { createTestTicket, resetTestTicket, deleteTestTicket, listTestTickets, overrideTicketStatus } from '../../src/controllers/adminController.js';
import { performTicketAction } from '../../src/controllers/actionController.js';
import { submitReport } from '../../src/controllers/ticketController.js';
import { loadActionContext } from '../../src/services/actionContext.js';
import { availableActions } from '../../src/config/workflow.js';
import { loadViewer, buildTicketDetails, canViewAttachment, staffRole } from '../../src/services/visibility.js';
import { makeUser, makeOpenTicket, cleanup, pool } from './helpers.mjs';

// Test tickets are created through the endpoint, so the shared helpers do not track them.
// Their audit rows would block deleting the CI users, so remove them first.
async function cleanAll() {
  await pool.query(
    `DELETE FROM infra_tickets WHERE is_mock = TRUE
       AND applicant_id IN (SELECT id FROM infra_users WHERE email LIKE 'ci-%@test.local')`);
  await cleanup();
}
beforeEach(cleanAll);
after(async () => { await cleanAll(); await pool.end(); });

const fakeRes = () => {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const userOf = async (id) => (await pool.query('SELECT id, name, email, role, department, is_active FROM infra_users WHERE id = ?', [id]))[0][0];
const ticketRow = async (id) => (await pool.query('SELECT * FROM infra_tickets WHERE id = ?', [id]))[0][0];

// Runs the ticket_id param middleware. Returns { next: bool, status, req }.
async function throughParam(handler, user, id, headers, path) {
  const req = { headers, user, path, params: { ticket_id: String(id), id: String(id) } };
  const res = fakeRes();
  let called = false; let nextErr;
  await handler(req, res, (e) => { called = true; nextErr = e; }, String(id));
  if (nextErr) throw nextErr;
  return { next: called, status: called ? 200 : res.statusCode, req };
}
const asRole = (admin, id, role) => throughParam(testRoleForTicketParam, admin, id, { 'x-test-role': role });

async function newMockTicket(admin, body = { department: 'Civil', campus: 'NORTH' }) {
  const res = fakeRes();
  await createTestTicket({ user: admin, body }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body.ticket_id;
}
async function sysadmin() {
  return userOf(await makeUser({ role: 'SYSADMIN' }));
}

// ---- middleware ------------------------------------------------------------------------------
test('no header: request passes untouched', async () => {
  const admin = await sysadmin();
  const id = await newMockTicket(admin);
  const r = await throughParam(testRoleForTicketParam, admin, id, {});
  assert.equal(r.next, true);
  assert.equal(r.req.user.role, 'SYSADMIN');
  assert.equal(r.req.realUser, undefined);
});

test('Sysadmin + mock ticket + valid role: effective role switches, real user kept', async () => {
  const admin = await sysadmin();
  const id = await newMockTicket(admin);
  for (const role of TEST_ROLES) {
    const r = await asRole(admin, id, role.toLowerCase());
    assert.equal(r.next, true, role);
    assert.equal(r.req.user.role, role);
    assert.equal(r.req.user.id, admin.id);
    assert.equal(r.req.user.isTest, true);
    assert.equal(r.req.realUser.role, 'SYSADMIN');
  }
});

test('the header on a real ticket is refused with 403', async () => {
  const admin = await sysadmin();
  const applicant = await makeUser({ role: 'APPLICANT' });
  const real = await makeOpenTicket(applicant, null);
  const r = await asRole(admin, real, 'AE');
  assert.deepEqual([r.next, r.status], [false, 403]);
});

test('the header from a non-Sysadmin is refused with 403, even on a mock ticket', async () => {
  const admin = await sysadmin();
  const id = await newMockTicket(admin);
  for (const role of ['AE', 'JE', 'DIRECTOR', 'APPLICANT']) {
    const u = await userOf(await makeUser({ role }));
    const r = await asRole(u, id, 'DIRECTOR');
    assert.deepEqual([r.next, r.status], [false, 403], role);
  }
});

test('unknown or privileged roles in the header are refused with 400', async () => {
  const admin = await sysadmin();
  const id = await newMockTicket(admin);
  for (const role of ['SYSADMIN', 'ROOT', '']) {
    const r = await asRole(admin, id, role);
    assert.deepEqual([r.next, r.status], [false, 400], role);
  }
});

test('a missing ticket is refused with 403', async () => {
  const admin = await sysadmin();
  const r = await asRole(admin, 999999999, 'AE');
  assert.deepEqual([r.next, r.status], [false, 403]);
});

test('kill switch: MOCK_TESTING_ENABLED=false -> header 403, endpoints 404; unset -> enabled', async () => {
  const admin = await sysadmin();
  const id = await newMockTicket(admin);
  const saved = process.env.MOCK_TESTING_ENABLED;
  try {
    delete process.env.MOCK_TESTING_ENABLED;
    assert.equal((await asRole(admin, id, 'AE')).next, true);
    let res = fakeRes(); let ok = false;
    requireMockTesting({}, res, () => { ok = true; });
    assert.equal(ok, true);

    process.env.MOCK_TESTING_ENABLED = 'false';
    const r = await asRole(admin, id, 'AE');
    assert.deepEqual([r.next, r.status], [false, 403]);
    res = fakeRes(); ok = false;
    requireMockTesting({}, res, () => { ok = true; });
    assert.deepEqual([ok, res.statusCode], [false, 404]);
    // No header while disabled is still a normal request.
    assert.equal((await throughParam(testRoleForTicketParam, admin, id, {})).next, true);
  } finally {
    if (saved === undefined) delete process.env.MOCK_TESTING_ENABLED; else process.env.MOCK_TESTING_ENABLED = saved;
  }
});

test('the header on a route without a ticket id is refused with 400', () => {
  const run = (path, headers) => {
    const res = fakeRes(); let ok = false;
    rejectStrayTestRole({ path, headers }, res, () => { ok = true; });
    return [ok, res.statusCode];
  };
  const h = { 'x-test-role': 'AE' };
  for (const path of ['/queue', '/desk', '/applicant', '/', '/je/dashboard']) {
    assert.deepEqual(run(path, h), [false, 400], path);
  }
  assert.deepEqual(run('/12/details', h), [true, 200]);
  assert.deepEqual(run('/12', h), [true, 200]);
  assert.deepEqual(run('/queue', {}), [true, 200]);
});

test('attachment route: header works on a mock ticket file only', async () => {
  const admin = await sysadmin();
  const id = await newMockTicket(admin);
  const applicant = await makeUser({ role: 'APPLICANT' });
  const realTicket = await makeOpenTicket(applicant, null);
  const att = async (ticketId) => (await pool.query(
    "INSERT INTO infra_attachments (ticket_id, file_url, uploaded_by, document_category) VALUES (?, '/uploads/x.png', ?, 'JE_SITE_PHOTO')",
    [ticketId, admin.id]))[0].insertId;
  const onMock = await att(id);
  const onReal = await att(realTicket);
  const go = (aid) => throughParam(testRoleForAttachmentParam, admin, aid, { 'x-test-role': 'APPLICANT' });
  assert.equal((await go(onMock)).next, true);
  assert.equal((await go(onReal)).status, 403);
});

// ---- test-ticket endpoints -----------------------------------------------------------------------------
test('create: validates input, raises a mock ticket at the Sysadmin desk, optional stub estimate', async () => {
  const admin = await sysadmin();
  for (const body of [{}, { department: 'Civil' }, { department: 'Nope', campus: 'NORTH' },
    { department: 'Civil', campus: 'NORTH', estimate: 'lots' }, { department: 'Civil', campus: 'NORTH', estimate: -1 }]) {
    const res = fakeRes();
    await createTestTicket({ user: admin, body }, res);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
  const id = await newMockTicket(admin, { department: 'Electrical', campus: 'SOUTH', estimate: 75000 });
  const row = await ticketRow(id);
  assert.equal(row.is_mock, 1);
  assert.equal(row.status, 'ASSIGNED_TO_JE');
  assert.deepEqual([row.applicant_id, row.assigned_je_id, row.current_desk_user_id], [admin.id, admin.id, admin.id]);
  const [[rep]] = await pool.query('SELECT estimated_amount FROM infra_reports WHERE ticket_id = ?', [id]);
  assert.equal(Number(rep.estimated_amount), 75000);

  const list = fakeRes();
  await listTestTickets({}, list);
  assert.ok(list.body.tickets.some((t) => t.id === id));
});

test('delete and reset refuse a real ticket and change nothing', async () => {
  const admin = await sysadmin();
  const applicant = await makeUser({ role: 'APPLICANT' });
  const real = await makeOpenTicket(applicant, null);
  const before = await ticketRow(real);
  for (const fn of [deleteTestTicket, resetTestTicket]) {
    const res = fakeRes();
    await fn({ user: admin, params: { ticket_id: String(real) } }, res);
    assert.equal(res.statusCode, 403);
  }
  const missing = fakeRes();
  await deleteTestTicket({ user: admin, params: { ticket_id: '999999999' } }, missing);
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(await ticketRow(real), before);
});

// ---- the full walk on one mock ticket -------------------------------------------------------------------------
test('walk: JE report -> AE -> SE -> Dean -> Director, each role switch shows the right actions', async () => {
  const admin = await sysadmin();
  const id = await newMockTicket(admin);

  const actionsFor = async (role) => {
    const { req } = await asRole(admin, id, role);
    const ctx = await loadActionContext(pool, await ticketRow(id), { id: req.user.id, role: req.user.role });
    return availableActions({ id: req.user.id, role: req.user.role }, ctx.ticket, ctx.limits).actions.map((a) => a.action);
  };
  const act = async (role, body) => {
    const { req } = await asRole(admin, id, role);
    const res = fakeRes();
    await performTicketAction({ ...req, params: { ticket_id: String(id) }, body }, res);
    assert.equal(res.statusCode, 200, `${role} ${JSON.stringify(body)} -> ${JSON.stringify(res.body)}`);
  };

  // JE desk: only the JE may file a report.
  assert.deepEqual(await actionsFor('JE'), ['SUBMIT_REPORT']);
  for (const role of ['AE', 'SE', 'DEAN', 'DIRECTOR']) assert.deepEqual(await actionsFor(role), [], role);

  const { req: jeReq } = await asRole(admin, id, 'JE');
  const rep = fakeRes();
  await submitReport({ ...jeReq, params: { ticket_id: String(id) }, body: { nature_of_work: 'Fix pipe', estimated_amount: '1000', remarks: 'ok' }, files: undefined }, rep);
  assert.equal(rep.statusCode, 200, JSON.stringify(rep.body));

  assert.deepEqual(await actionsFor('AE'), ['FORWARD', 'REQUEST_CHANGES']);
  assert.deepEqual(await actionsFor('JE'), []);
  await act('AE', { action: 'FORWARD' });

  assert.ok((await actionsFor('SE')).includes('APPROVE'));
  assert.deepEqual(await actionsFor('AE'), []);
  await act('SE', { action: 'FORWARD' });

  assert.ok((await actionsFor('DEAN')).includes('FORWARD'));
  await act('DEAN', { action: 'FORWARD' });

  assert.ok((await actionsFor('DIRECTOR')).includes('APPROVE'));
  await act('DIRECTOR', { action: 'APPROVE' });

  const row = await ticketRow(id);
  assert.equal(row.status, 'APPROVED_FOR_TENDERING');
  assert.equal(row.is_mock, 1);

  // Every audit row belongs to the real Sysadmin and says which role was played.
  const [audit] = await pool.query('SELECT user_id, action, remarks, is_self_action FROM infra_audit_logs WHERE ticket_id = ? ORDER BY id', [id]);
  const played = audit.filter((a) => a.action !== 'CREATED');
  assert.ok(played.length >= 5);
  for (const a of played) {
    assert.equal(a.user_id, admin.id);
    assert.match(a.remarks, /^\[TEST as (JE|AE|SE|DEAN|DIRECTOR)\] /);
    assert.equal(a.is_self_action, 0);
  }
  // No mail, no reminders.
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM infra_notifications WHERE ticket_id = ?', [id]);
  assert.equal(n, 0);

  // Reset returns it to the JE stage and clears the walk.
  const reset = fakeRes();
  await resetTestTicket({ user: admin, params: { ticket_id: String(id) } }, reset);
  assert.equal(reset.statusCode, 200);
  const after_ = await ticketRow(id);
  assert.deepEqual([after_.status, after_.current_desk_user_id, after_.assigned_ae_id, after_.assigned_se_id],
    ['ASSIGNED_TO_JE', admin.id, null, null]);
  assert.equal((await pool.query('SELECT 1 FROM infra_reports WHERE ticket_id = ?', [id]))[0].length, 0);
  assert.equal((await pool.query('SELECT 1 FROM infra_ticket_messages WHERE ticket_id = ?', [id]))[0].length, 0);
  assert.deepEqual(await actionsFor('JE'), ['SUBMIT_REPORT']);

  // Delete removes it.
  const del = fakeRes();
  await deleteTestTicket({ user: admin, params: { ticket_id: String(id) } }, del);
  assert.equal(del.statusCode, 200);
  assert.equal(await ticketRow(id), undefined);
});

test('override still works on a mock ticket and keeps the Sysadmin as holder', async () => {
  const admin = await sysadmin();
  const id = await newMockTicket(admin);
  const res = fakeRes();
  await overrideTicketStatus({ user: admin, params: { ticket_id: String(id) }, body: { remarks: 'jump', new_status: 'PENDING_DEAN_APPROVAL' } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal((await ticketRow(id)).current_desk_user_id, admin.id);
});

// ---- visibility as the acted role --------------------------------------------------------------------------------
test('as APPLICANT the Sysadmin sees the applicant projection: no staff identities, no audit log', async () => {
  const admin = await sysadmin();
  const id = await newMockTicket(admin);
  const { req } = await asRole(admin, id, 'APPLICANT');
  const row = { ...(await ticketRow(id)), applicant_name: admin.name, applicant_email: admin.email };
  const viewer = await loadViewer(pool, req.user, row);
  assert.equal(staffRole(viewer, row), null);
  const out = buildTicketDetails(viewer, row, {
    attachments: [{ id: 1, file_url: '/uploads/a.png', uploaded_by: admin.id, document_category: 'JE_SITE_PHOTO', uploader_role: 'JE' }],
    reports: [{ estimated_amount: 5 }], tenders: [],
    auditLogs: [{ action: 'SUBMITTED', remarks: 'r', created_at: 1, user_id: admin.id, actor_name: admin.name, actor_role: 'JE' }],
    messages: [],
  });
  for (const k of ['assigned_je_id', 'assigned_ae_id', 'assigned_se_id', 'current_desk_user_id', 'is_mock', 'applicant_email', 'assignees']) {
    assert.equal(k in out, false, k);
  }
  assert.equal(out.report, null);
  assert.deepEqual(out.audit_logs, []);
  assert.deepEqual(out.attachments, []); // the JE photo uploaded by the Sysadmin is still hidden from the applicant view
  assert.equal(JSON.stringify(out).includes(admin.name), false);
});

test('as JE the Sysadmin gets the JE view, not the union with the applicant view', async () => {
  const admin = await sysadmin();
  const id = await newMockTicket(admin);
  const { req } = await asRole(admin, id, 'JE');
  const viewer = await loadViewer(pool, req.user, await ticketRow(id));
  assert.equal(viewer.isApplicant, false);
  assert.equal(staffRole(viewer, await ticketRow(id)), 'JE');
});

test('test mode does not let "own upload" bypass the category rules', async () => {
  const admin = await sysadmin();
  const id = await newMockTicket(admin);
  const row = await ticketRow(id);
  const att = { document_category: 'DESK_DOC', uploaded_by: admin.id, uploader_role: 'AE' };
  const { req } = await asRole(admin, id, 'APPLICANT');
  const viewer = await loadViewer(pool, req.user, row);
  assert.equal(canViewAttachment(viewer, row, att), false);
});
