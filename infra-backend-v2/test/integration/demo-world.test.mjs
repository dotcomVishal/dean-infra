// Demo LDAP login and the demo world (Agent/demo-plan.md) over real HTTP.
// The demo accounts and demo tickets this file creates are removed in `after`, so other test files see a
// clean database. (Production keeps its demo tickets; this clean-up is for the throwaway test database only.)
process.env.DEMO_LDAP_PASSWORD = 'correct horse battery';
delete process.env.DEMO_LDAP_ENABLED;

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { call, stopServer, baseUrl, samplePdf } from './http-helpers.mjs';
import { auth } from '../../src/config/firebase.js';
import { TICKETS_DIR } from '../../src/config/paths.js';
import { syncDemoAccounts, DEMO_ACCOUNTS } from '../../src/config/demo.js';
import { findDeskOwner, fallbackSysadmin } from '../../src/models/deskModel.js';
import { makeUser, makeOpenTicket, cleanup, inRolledBackTx, pool } from './helpers.mjs';

// The stub from http-helpers only knows Google-style test tokens. A "demo_<role>" token is what a custom
// token for that account would decode to.
const googleStub = auth.verifyIdToken;
auth.verifyIdToken = async (t) => (String(t).startsWith('demo_')
  ? { uid: t, firebase: { sign_in_provider: 'custom' } }
  : googleStub(t));

const ticketIds = [];
after(async () => {
  for (const id of ticketIds) fs.rmSync(path.join(TICKETS_DIR, String(id)), { recursive: true, force: true });
  await pool.query("DELETE FROM mnt_tickets WHERE is_demo = TRUE");
  await pool.query("DELETE FROM mnt_notifications WHERE to_user_id IN (SELECT id FROM mnt_users WHERE is_demo = TRUE)");
  await pool.query("DELETE FROM mnt_user_availability WHERE user_id IN (SELECT id FROM mnt_users WHERE is_demo = TRUE) OR created_by IN (SELECT id FROM mnt_users WHERE is_demo = TRUE)");
  await pool.query('DELETE FROM mnt_users WHERE is_demo = TRUE');
  await cleanup();
  await stopServer();
  await pool.end();
});

const turnOn = async () => { process.env.DEMO_LDAP_ENABLED = 'true'; await syncDemoAccounts(pool); };
const turnOff = async () => { delete process.env.DEMO_LDAP_ENABLED; await syncDemoAccounts(pool); };
const T = (role) => `demo_${role}`;
const row = async (id) => (await pool.query('SELECT * FROM mnt_tickets WHERE id = ?', [id]))[0][0];
const ldap = (body) => fetch(`${baseUrl}/api/auth/ldap`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const form = (fields, ...files) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  files.forEach((f) => fd.append('files', f));
  return fd;
};
const uid = async (id) => (await pool.query('SELECT firebase_uid FROM mnt_users WHERE id = ?', [id]))[0][0].firebase_uid;
const holderIsDemo = async (id) => {
  const [[r]] = await pool.query(
    'SELECT u.is_demo AS d FROM mnt_tickets t JOIN mnt_users u ON u.id = t.current_desk_user_id WHERE t.id = ?', [id]);
  return !!r?.d;
};
const raise = async () => {
  const r = await call(T('applicant'), 'POST', '/api/tickets', form({
    description: 'Demo leak at the main gate', department: 'Civil', campus: 'NORTH', landmark: 'Main gate', contact_phone: '9999999999',
  }));
  assert.equal(r.status, 200, r.text);
  ticketIds.push(r.body.ticket_id);
  return r.body.ticket_id;
};

test('1. switch off: ldap is 503, a demo token is 401, no demo row is active', async () => {
  await turnOff();
  assert.equal((await ldap({ username: 'demo.je', password: 'correct horse battery' })).status, 503);
  assert.equal((await call(T('applicant'), 'GET', '/api/tickets/applicant')).status, 401);
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM mnt_users WHERE is_demo = TRUE AND is_active = TRUE');
  assert.equal(Number(n), 0);
});

test('1b. a short password keeps the switch off', async () => {
  process.env.DEMO_LDAP_ENABLED = 'true';
  const good = process.env.DEMO_LDAP_PASSWORD;
  process.env.DEMO_LDAP_PASSWORD = 'short';
  await syncDemoAccounts(pool);
  assert.equal((await ldap({ username: 'demo.je', password: 'short' })).status, 503);
  process.env.DEMO_LDAP_PASSWORD = good;
  await turnOff();
});

test('2. wrong password and unknown username are 401; a correct pair returns a token and is_demo', async () => {
  await turnOn();
  assert.equal((await ldap({ username: 'demo.je', password: 'nope' })).status, 401);
  assert.equal((await ldap({ username: 'demo.nobody', password: 'correct horse battery' })).status, 401);
  assert.equal((await ldap({})).status, 401);
  assert.equal(DEMO_ACCOUNTS.length, 9);
  for (const a of DEMO_ACCOUNTS) {
    const res = await ldap({ username: a.username, password: 'correct horse battery' });
    assert.equal(res.status, 200, a.username);
    const body = await res.json();
    assert.equal(typeof body.token, 'string');
    assert.equal(body.user.is_demo, true);
    assert.equal(body.user.role, a.role);
  }
});

test('3. a Google token never resolves to a demo row', async () => {
  await turnOn();
  // A Google token whose uid happens to be a demo uid, and one whose e-mail is a demo e-mail.
  const uidOnly = await call('demo_je_google', 'GET', '/api/tickets/applicant');
  assert.equal(uidOnly.status, 401); // not a ci- token: rejected by the stub
  const [[je]] = await pool.query("SELECT firebase_uid FROM mnt_users WHERE firebase_uid = 'demo_je'");
  assert.ok(je);
  auth.verifyIdToken = async (t) => (t === 'g-demo-uid'
    ? { uid: 'demo_je', email: 'x@test.local', email_verified: true, firebase: { sign_in_provider: 'google.com' } }
    : t === 'g-demo-mail'
      ? { uid: 'g-other', email: 'demo.je@demo.invalid', email_verified: true, firebase: { sign_in_provider: 'google.com' } }
      : String(t).startsWith('demo_') ? { uid: t, firebase: { sign_in_provider: 'custom' } } : googleStub(t));
  try {
    assert.equal((await call('g-demo-uid', 'GET', '/api/tickets/applicant')).status, 403);
    assert.equal((await call('g-demo-mail', 'GET', '/api/tickets/applicant')).status, 403);
    const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM mnt_users WHERE firebase_uid = 'g-other'");
    assert.equal(Number(n), 0);
  } finally {
    auth.verifyIdToken = async (t) => (String(t).startsWith('demo_') ? { uid: t, firebase: { sign_in_provider: 'custom' } } : googleStub(t));
  }
  // A custom token for a uid outside the fixed list is refused.
  auth.verifyIdToken = async (t) => ({ uid: t, firebase: { sign_in_provider: 'custom' } });
  assert.equal((await call('someone_else', 'GET', '/api/tickets/applicant')).status, 401);
  auth.verifyIdToken = async (t) => (String(t).startsWith('demo_') ? { uid: t, firebase: { sign_in_provider: 'custom' } } : googleStub(t));
});

test('4. a demo ticket is mock + demo, sits with the demo JE, and queues no mail', async () => {
  await turnOn();
  const id = await raise();
  const t = await row(id);
  assert.equal(t.is_mock, 1);
  assert.equal(t.is_demo, 1);
  assert.equal(t.status, 'ASSIGNED_TO_JE');
  assert.equal(await uid(t.assigned_je_id), 'demo_je');
  assert.equal(await holderIsDemo(id), true);
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM mnt_notifications WHERE ticket_id = ?', [id]);
  assert.equal(Number(n), 0);
});

test('5. full walk, every desk is a demo account at every step', async () => {
  await turnOn();
  const id = await raise();
  const step = async (label, res, status) => {
    assert.equal(res.status, 200, `${label}: ${res.text}`);
    if (status) assert.equal((await row(id)).status, status, label);
    if (status && !['CLOSED', 'DENIED'].includes(status)) {
      const desk = (await row(id)).current_desk_user_id;
      if (desk != null) assert.equal(await holderIsDemo(id), true, `${label}: desk holder is a demo account`);
    }
  };

  await step('report', await call(T('je'), 'POST', `/api/tickets/${id}/report`, form(
    { nature_of_work: 'Pipe repair', estimated_amount: '600000', remarks: 'site seen' })), 'PENDING_AE_APPROVAL');
  assert.equal(await uid((await row(id)).current_desk_user_id), 'demo_ae');
  await step('ae', await call(T('ae'), 'POST', `/api/tickets/${id}/actions`, form({ action: 'FORWARD' })), 'PENDING_SE_APPROVAL');
  assert.equal(await uid((await row(id)).current_desk_user_id), 'demo_se');
  await step('se', await call(T('se'), 'POST', `/api/tickets/${id}/actions`, form({ action: 'FORWARD' })), 'PENDING_DEAN_APPROVAL');
  assert.equal(await uid((await row(id)).current_desk_user_id), 'demo_dean');
  await step('dean', await call(T('dean'), 'POST', `/api/tickets/${id}/actions`, form({ action: 'FORWARD' })), 'PENDING_DIRECTOR_APPROVAL');
  assert.equal(await uid((await row(id)).current_desk_user_id), 'demo_director');
  await step('director', await call(T('director'), 'POST', `/api/tickets/${id}/actions`, form({ action: 'APPROVE' })), 'APPROVED_FOR_TENDERING');

  const stage = (fields, ...files) => call(T('je'), 'POST', `/api/tickets/${id}/tender-stage`, form(fields, ...files));
  await step('publish', await stage({ stage: 'PUBLISH', nit_number: 'NIT/DEMO/1', portal_type: 'GeM', published_date: '2026-10-01', bid_end_date: '2026-10-20' }, samplePdf('nit.pdf')), 'TENDER_PUBLISHED');
  assert.equal((await call(T('clerical'), 'GET', `/api/tickets/${id}/tenders`)).status, 200);
  await step('technical', await stage({ stage: 'TECHNICAL' }), 'TECHNICAL_EVALUATION');
  await step('financial', await stage({ stage: 'FINANCIAL' }), 'FINANCIAL_EVALUATION');
  await step('award', await stage({ stage: 'AWARD', awarded_agency: 'Demo Builders', award_amount: '550000' }), 'WORK_IN_PROGRESS');

  const bill = await call(T('accountant'), 'POST', `/api/tickets/${id}/bills`, {
    bill_number: 'DEMO-1', agency_name: 'Demo Builders', gross_amount: '1000', deductions: '100', net_amount: '900' });
  assert.equal(bill.status, 200, bill.text);
  assert.equal((await call(T('accountant'), 'GET', `/api/tickets/${id}/bills`)).status, 200);

  await step('resolve', await call(T('je'), 'POST', `/api/tickets/${id}/resolve`, { note: 'Finished' }), 'WORK_COMPLETED');
  await step('confirm', await call(T('applicant'), 'POST', `/api/tickets/${id}/confirm-completion`, { accepted: true }), 'CLOSED');

  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM mnt_notifications WHERE ticket_id = ?', [id]);
  assert.equal(Number(n), 0, 'no mail queued for a demo ticket');
});

test('6. a demo account cannot reach real tickets, attachments or bills', async () => {
  await turnOn();
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je = await makeUser({ role: 'JE' });
  const accountant = await makeUser({ role: 'ACCOUNTANT' });
  const real = await makeOpenTicket(applicant, je, 'PENDING_DEAN_APPROVAL');
  const [att] = await pool.query(
    "INSERT INTO mnt_attachments (ticket_id, file_url, uploaded_by) VALUES (?, '/uploads/tickets/x/y.pdf', ?)", [real, applicant]);
  const [bill] = await pool.query(
    "INSERT INTO mnt_bills (ticket_id, bill_number, agency_name, gross_amount, net_amount, processed_by, payment_status) VALUES (?, 'REAL-1', 'Real Co', 777777, 777777, ?, 'PENDING')",
    [real, accountant]);

  for (const role of ['dean', 'applicant', 'je', 'sysadmin', 'accountant']) {
    assert.equal((await call(T(role), 'GET', `/api/tickets/${real}/details`)).status, 404, `${role} details`);
  }
  assert.equal((await call(T('dean'), 'POST', `/api/tickets/${real}/actions`, form({ action: 'FORWARD' }))).status, 404);
  assert.equal((await call(T('accountant'), 'GET', `/api/tickets/${real}/bills`)).status, 404);
  assert.equal((await call(T('clerical'), 'GET', `/api/tickets/${real}/tenders`)).status, 404);
  assert.equal((await call(T('dean'), 'GET', `/api/attachments/${att.insertId}`)).status, 404);
  assert.equal((await call(T('accountant'), 'PATCH', `/api/tickets/bills/${bill.insertId}`, { payment_status: 'DISBURSED' })).status, 404);
  assert.equal((await call(T('sysadmin'), 'GET', `/api/admin/tickets/${real}/details`)).status, 404);

  const queue = await call(T('dean'), 'GET', '/api/tickets/queue');
  assert.equal(queue.status, 200);
  assert.ok(!queue.body.tickets?.some((t) => t.id === real), 'real ticket not in the demo Dean queue');
  const desk = await call(T('dean'), 'GET', '/api/tickets/desk');
  assert.ok(!desk.body.my_desk.some((t) => t.id === real));
  const overview = await call(T('accountant'), 'GET', '/api/tickets/accountant/overview');
  assert.equal(overview.status, 200);
  assert.ok(overview.body.summary.totalPendingDisbursement < 777777, 'real bill not in the demo finance totals');
});

test('7. real users never see a demo ticket', async () => {
  await turnOn();
  const id = await raise();
  const dean = await makeUser({ role: 'DEAN' });
  const ae = await makeUser({ role: 'AE', campus: 'NORTH' });
  const applicant = await makeUser({ role: 'APPLICANT' });
  await pool.query("UPDATE mnt_tickets SET status = 'PENDING_DEAN_APPROVAL' WHERE id = ?", [id]);
  for (const user of [dean, ae, applicant]) {
    const token = await uid(user);
    assert.equal((await call(token, 'GET', `/api/tickets/${id}/details`)).status, 403);
    assert.equal((await call(token, 'GET', `/api/tickets/${id}/tenders`)).status, 403);
  }
  const queue = await call(await uid(dean), 'GET', '/api/tickets/queue');
  assert.ok(!queue.body.tickets.some((t) => t.id === id));
  const desk = await call(await uid(dean), 'GET', '/api/tickets/desk');
  assert.ok(![...desk.body.my_desk, ...desk.body.watching].some((t) => t.id === id));
  const accountant = await makeUser({ role: 'ACCOUNTANT' });
  await pool.query("UPDATE mnt_tickets SET status = 'WORK_IN_PROGRESS' WHERE id = ?", [id]);
  assert.equal((await call(await uid(accountant), 'GET', `/api/tickets/${id}/bills`)).status, 403);
  // Real Sysadmin may open it (admin console), a real X-Test-Role may not.
  const sys = await makeUser({ role: 'SYSADMIN' });
  assert.equal((await call(await uid(sys), 'GET', `/api/admin/tickets/${id}/details`)).status, 200);
  const res = await fetch(`${baseUrl}/api/tickets/${id}/details`, { headers: { Authorization: `Bearer ${await uid(sys)}`, 'X-Test-Role': 'DEAN' } });
  assert.equal(res.status, 403);
});

test('8. routing never picks a demo account, even when no real holder is active', async () => {
  await turnOn();
  const t = { id: 0, status: 'PENDING_SE_APPROVAL', department: 'Civil', campus: 'NORTH', applicant_id: 1, is_mock: 0, is_demo: 0 };
  await inRolledBackTx(async (conn) => {
    await conn.query("UPDATE mnt_users SET is_active = FALSE WHERE is_demo = FALSE AND role IN ('AE','SE','DEAN','DIRECTOR','SYSADMIN')");
    for (const desk of ['AE', 'SE', 'DEAN', 'DIRECTOR']) {
      assert.equal(await findDeskOwner(conn, t, desk), null, desk);
    }
    assert.equal(await fallbackSysadmin(conn), null);
  });
});

test('9. saving a real Dean keeps the demo Dean active; editing a demo account is 403', async () => {
  await turnOn();
  const sys = await uid(await makeUser({ role: 'SYSADMIN' }));
  const dean = await makeUser({ role: 'DEAN' });
  const saved = await call(sys, 'PATCH', `/api/admin/users/${dean}`, { is_active: true });
  assert.equal(saved.status, 200, saved.text);
  const [[demoDean]] = await pool.query("SELECT id, is_active FROM mnt_users WHERE firebase_uid = 'demo_dean'");
  assert.equal(demoDean.is_active, 1);
  assert.equal((await call(sys, 'PATCH', `/api/admin/users/${demoDean.id}`, { is_active: false })).status, 403);
  const list = await call(sys, 'GET', '/api/admin/users');
  assert.ok(!list.body.users.some((u) => String(u.email).endsWith('@demo.invalid')), 'real Sysadmin does not list demo accounts');
});

test('10. a demo AE cannot mark leave for a real JE', async () => {
  await turnOn();
  const je = await makeUser({ role: 'JE' });
  const r = await call(T('ae'), 'POST', '/api/availability', {
    user_id: je, start_at: new Date(Date.now() + 3600e3).toISOString(), end_at: new Date(Date.now() + 7200e3).toISOString() });
  assert.equal(r.status, 404);
});

test('11. every /api/admin route is 403 for the eight non-Sysadmin demo accounts', async () => {
  await turnOn();
  for (const a of DEMO_ACCOUNTS.filter((x) => x.role !== 'SYSADMIN')) {
    for (const [method, url] of [['GET', '/api/admin/metrics'], ['GET', '/api/admin/users'], ['POST', '/api/admin/users'], ['GET', '/api/admin/tickets']]) {
      assert.equal((await call(T(a.role.toLowerCase()), method, url, method === 'POST' ? {} : undefined)).status, 403, `${a.role} ${url}`);
    }
  }
});

test('12. demo Sysadmin: read-only, demo rows only, no act-as', async () => {
  await turnOn();
  const id = await raise();
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je = await makeUser({ role: 'JE' });
  const real = await makeOpenTicket(applicant, je, 'PENDING_DEAN_APPROVAL');
  const sys = T('sysadmin');

  // Writes and routes outside the allow-list.
  for (const [method, url] of [
    ['POST', `/api/admin/tickets/${id}/override`], ['DELETE', `/api/admin/tickets/${id}`], ['POST', '/api/admin/users'],
    ['PATCH', '/api/admin/users/1'], ['GET', '/api/admin/jes'], ['GET', '/api/admin/staff?role=JE'], ['GET', '/api/admin/test-tickets'],
    ['POST', '/api/admin/test-tickets'], ['PUT', '/api/admin/limits'], ['GET', '/api/admin/deleted-tickets'], ['POST', '/api/admin/digest/preview'],
  ]) {
    const r = await call(sys, method, url, method === 'GET' ? undefined : {});
    assert.equal(r.status, 403, `${method} ${url}`);
    assert.equal(r.body.code, 'DEMO_READ_ONLY');
  }

  const limits = await call(sys, 'GET', '/api/admin/limits');
  assert.equal(limits.status, 200, limits.text);

  const metrics = await call(sys, 'GET', '/api/admin/metrics');
  assert.equal(metrics.status, 200, metrics.text);
  assert.ok(metrics.body.metrics.totalTickets >= 1);
  assert.equal(metrics.body.desk_health, undefined);
  const [[{ demoTotal }]] = await pool.query('SELECT COUNT(*) AS demoTotal FROM mnt_tickets WHERE is_demo = TRUE');
  assert.equal(Number(metrics.body.metrics.totalTickets), Number(demoTotal));
  const [[{ demoUsers }]] = await pool.query('SELECT COUNT(*) AS demoUsers FROM mnt_users WHERE is_demo = TRUE');
  assert.equal(Number(metrics.body.metrics.totalUsers), Number(demoUsers));

  const list = await call(sys, 'GET', '/api/admin/tickets?include_mock=1');
  assert.equal(list.status, 200);
  assert.ok(list.body.tickets.length > 0 && list.body.tickets.every((t) => ticketIds.includes(t.id)));
  assert.ok(!list.body.tickets.some((t) => t.id === real));
  const csv = await call(sys, 'GET', '/api/admin/tickets/export?include_mock=1');
  assert.equal(csv.status, 200);
  assert.ok(!csv.text.includes(`TKT-${String(real).padStart(4, '0')}`));
  const users = await call(sys, 'GET', '/api/admin/users');
  assert.ok(users.body.users.length === Number(demoUsers) && users.body.users.every((u) => u.email.endsWith('@demo.invalid')));
  const logs = await call(sys, 'GET', '/api/admin/audit-logs?include_mock=1');
  assert.equal(logs.status, 200);
  assert.ok(logs.body.logs.length > 0 && logs.body.logs.every((l) => ticketIds.includes(l.ticket_id)));
  assert.equal((await call(sys, 'GET', `/api/admin/tickets/${id}/details`)).status, 200);
  assert.equal((await call(sys, 'GET', `/api/admin/tickets/${real}/details`)).status, 404);

  // No act-as.
  const act = await fetch(`${baseUrl}/api/tickets/${id}/details`, { headers: { Authorization: `Bearer ${sys}`, 'X-Test-Role': 'DEAN' } });
  assert.equal(act.status, 403);

  // The real Sysadmin's numbers do not change when demo tickets exist.
  const realSys = await uid(await makeUser({ role: 'SYSADMIN' }));
  const before = (await call(realSys, 'GET', '/api/admin/metrics')).body.metrics.totalTickets;
  await raise();
  assert.equal((await call(realSys, 'GET', '/api/admin/metrics')).body.metrics.totalTickets, before);
  const realList = await call(realSys, 'GET', '/api/admin/tickets');
  assert.ok(!realList.body.tickets.some((t) => ticketIds.includes(t.id)));
});

test('13. switch off then on: a demo ticket keeps its demo desk and is in no real list meanwhile', async () => {
  await turnOn();
  const id = await raise();
  await call(T('je'), 'POST', `/api/tickets/${id}/report`, form({ nature_of_work: 'x', estimated_amount: '100', remarks: 'r' }));
  await call(T('ae'), 'POST', `/api/tickets/${id}/actions`, form({ action: 'FORWARD' }));
  const before = (await row(id)).current_desk_user_id;
  assert.equal(await uid(before), 'demo_se');

  await turnOff();
  const dean = await makeUser({ role: 'DEAN' });
  const queue = await call(await uid(dean), 'GET', '/api/tickets/queue');
  assert.ok(!queue.body.tickets.some((t) => t.id === id));
  assert.equal((await call(T('se'), 'GET', '/api/tickets/queue')).status, 401);
  const { reconcileDeskOwners } = await import('../../src/models/deskModel.js');
  await reconcileDeskOwners(pool);
  assert.equal((await row(id)).current_desk_user_id, before);

  await turnOn();
  assert.equal((await row(id)).current_desk_user_id, before);
  const queue2 = await call(T('se'), 'GET', '/api/tickets/queue');
  assert.ok(queue2.body.tickets.some((t) => t.id === id));
});
