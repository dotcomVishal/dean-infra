// Sysadmin edits the SE and Dean approval limits over real HTTP. The seeded values
// (50,000 and 500,000) are put back in `after`: other test files rely on them.
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { call, stopServer } from './http-helpers.mjs';
import { makeUser, makeOpenTicket, cleanup, pool } from './helpers.mjs';

const SEEDED = { SE_APPROVE: 50000, DEAN_APPROVE: 500000 };

const stored = async () => Object.fromEntries(
  (await pool.query("SELECT `key`, max_amount FROM financial_limits WHERE `key` IN ('SE_APPROVE','DEAN_APPROVE')"))[0]
    .map((r) => [r.key, Number(r.max_amount)]));
const restore = async () => {
  await pool.query(
    `INSERT INTO financial_limits (\`key\`, max_amount) VALUES ('SE_APPROVE', ?), ('DEAN_APPROVE', ?)
     ON DUPLICATE KEY UPDATE max_amount = VALUES(max_amount), updated_by = NULL`, [SEEDED.SE_APPROVE, SEEDED.DEAN_APPROVE]);
};
const uid = async (id) => (await pool.query('SELECT firebase_uid FROM users WHERE id = ?', [id]))[0][0].firebase_uid;

beforeEach(async () => { await restore(); await cleanup(); });
after(async () => {
  await restore();
  await cleanup();
  await stopServer();
  await pool.end();
});

test('a Sysadmin reads and updates both limits; anyone else gets 403', async () => {
  const admin = await makeUser({ role: 'SYSADMIN', name: 'Limits Admin' });
  const adminUid = await uid(admin);

  const read = await call(adminUid, 'GET', '/api/admin/limits');
  assert.equal(read.status, 200, read.text);
  assert.equal(read.body.limits.SE_APPROVE.amount, 50000);
  assert.equal(read.body.limits.DEAN_APPROVE.amount, 500000);

  const put = await call(adminUid, 'PUT', '/api/admin/limits', { SE_APPROVE: 75000, DEAN_APPROVE: '800000.50' });
  assert.equal(put.status, 200, put.text);
  assert.deepEqual(await stored(), { SE_APPROVE: 75000, DEAN_APPROVE: 800000.5 });
  assert.equal(put.body.limits.SE_APPROVE.updated_by, 'Limits Admin');

  for (const role of ['SE', 'DEAN', 'JE', 'APPLICANT']) {
    const other = await uid(await makeUser({ role }));
    assert.equal((await call(other, 'GET', '/api/admin/limits')).status, 403, role);
    assert.equal((await call(other, 'PUT', '/api/admin/limits', { SE_APPROVE: 1, DEAN_APPROVE: 2 })).status, 403, role);
  }
});

test('every bad input is refused and nothing is written', async () => {
  const adminUid = await uid(await makeUser({ role: 'SYSADMIN' }));
  const bad = [
    { SE_APPROVE: 0, DEAN_APPROVE: 500000 },
    { SE_APPROVE: -5, DEAN_APPROVE: 500000 },
    { SE_APPROVE: 'lots', DEAN_APPROVE: 500000 },
    { SE_APPROVE: '', DEAN_APPROVE: 500000 },
    { SE_APPROVE: null, DEAN_APPROVE: 500000 },
    { SE_APPROVE: 100.123, DEAN_APPROVE: 500000 },
    { SE_APPROVE: 100, DEAN_APPROVE: 1e15 },
    { SE_APPROVE: 600000, DEAN_APPROVE: 500000 },
    { SE_APPROVE: 500000, DEAN_APPROVE: 500000 },
    { SE_APPROVE: 100 },
    { SE_APPROVE: 100, DEAN_APPROVE: 200, DIRECT_AWARD: 5 },
    { SE_APPROVE: 100, DEAN_APPROVE: 200, DEAN_HIGH_VALUE: 5 },
  ];
  for (const body of bad) {
    const r = await call(adminUid, 'PUT', '/api/admin/limits', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(await stored(), SEEDED, JSON.stringify(body));
  }
});

test('raising the SE limit lets the SE approve an estimate that used to pass up', async () => {
  const adminUid = await uid(await makeUser({ role: 'SYSADMIN' }));
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je = await makeUser({ role: 'JE' });
  const se = await makeUser({ role: 'SE' });
  const id = await makeOpenTicket(applicant, je, 'PENDING_SE_APPROVAL');
  await pool.query('UPDATE tickets SET current_desk_user_id = ?, assigned_se_id = ? WHERE id = ?', [se, se, id]);
  await pool.query("INSERT INTO reports (ticket_id, je_id, version, nature_of_work, estimated_amount) VALUES (?, ?, 1, 'ci work', 60000)", [id, je]);

  const approve = async () => (await call(await uid(se), 'GET', `/api/tickets/${id}/details`))
    .body.ticket.available_actions.actions.find((a) => a.action === 'APPROVE');

  assert.equal((await approve()).escalates_to, 'DEAN'); // 60,000 is over the 50,000 SE limit
  assert.equal((await call(adminUid, 'PUT', '/api/admin/limits', { SE_APPROVE: 100000, DEAN_APPROVE: 500000 })).status, 200);
  const after = await approve();
  assert.equal(after.enabled, true);
  assert.equal(after.escalates_to, undefined); // the SE now approves it directly
});
