// core_users holds identity (shared by every module); mnt_members holds this module's role.
// No member row = APPLICANT. Deactivating the previous Dean is module-level only.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { call, stopServer } from './http-helpers.mjs';
import { makeUser, cleanup, pool } from './helpers.mjs';
import { bootstrapSysadmin } from '../../scripts/bootstrap-sysadmin.mjs';

const extraUsers = [];
after(async () => {
  if (extraUsers.length) await pool.query('DELETE FROM core_users WHERE id IN (?)', [extraUsers]);
  await cleanup();
  await stopServer();
  await pool.end();
});

const uid = async (id) => (await pool.query('SELECT firebase_uid FROM core_users WHERE id = ?', [id]))[0][0].firebase_uid;

test('a first Google sign-in creates a core_users row and no member row: an active applicant', async () => {
  const token = `ci-first-${randomUUID().slice(0, 8)}`;
  const r = await call(token, 'POST', '/api/auth/sync');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.user.role, 'APPLICANT');
  assert.equal(r.body.user.is_active, 1);
  const [[core]] = await pool.query('SELECT id FROM core_users WHERE firebase_uid = ?', [token]);
  extraUsers.push(core.id);
  const [members] = await pool.query('SELECT 1 FROM mnt_members WHERE user_id = ?', [core.id]);
  assert.equal(members.length, 0, 'no member row for an applicant');
  assert.equal((await call(token, 'GET', '/api/tickets/applicant')).status, 200);
});

test('the sync response lists explicit columns, not the whole row', async () => {
  const token = `ci-cols-${randomUUID().slice(0, 8)}`;
  const r = await call(token, 'POST', '/api/auth/sync');
  const [[core]] = await pool.query('SELECT id FROM core_users WHERE firebase_uid = ?', [token]);
  extraUsers.push(core.id);
  assert.deepEqual(Object.keys(r.body.user).sort(),
    ['campus', 'created_at', 'department', 'email', 'firebase_uid', 'id', 'is_active', 'is_demo', 'name', 'phone', 'role']);
});

test('two simultaneous first sign-ins with the same e-mail make one core_users row and no error', async () => {
  const token = `ci-race-${randomUUID().slice(0, 8)}`;
  const results = await Promise.all(Array.from({ length: 4 }, () => call(token, 'POST', '/api/auth/sync')));
  for (const r of results) assert.equal(r.status, 200, r.text);
  const [rows] = await pool.query('SELECT id FROM core_users WHERE email = ?', [`${token}@test.local`]);
  assert.equal(rows.length, 1);
  extraUsers.push(rows[0].id);
});

test('appointing a new Dean blocks the previous Dean in this module only', async () => {
  const admin = await makeUser({ role: 'SYSADMIN' });
  const oldDean = await makeUser({ role: 'DEAN' });
  const [before] = await pool.query("SELECT user_id, is_active FROM mnt_members WHERE role = 'DEAN'");
  try {
    const email = `ci-newdean-${randomUUID().slice(0, 6)}@test.local`;
    const created = await call(await uid(admin), 'POST', '/api/admin/users',
      { name: 'CI New Dean', email, role: 'DEAN', department: 'Administration' });
    assert.equal(created.status, 200, created.text);
    extraUsers.push(created.body.user.id);

    const [[core]] = await pool.query('SELECT is_active FROM core_users WHERE id = ?', [oldDean]);
    const [[member]] = await pool.query('SELECT is_active FROM mnt_members WHERE user_id = ?', [oldDean]);
    assert.equal(core.is_active, 1, 'account-wide switch untouched');
    assert.equal(member.is_active, 0, 'blocked in this module');
    assert.equal((await call(await uid(oldDean), 'GET', '/api/tickets/applicant')).status, 403, 'refused by this module');
  } finally {
    for (const b of before) await pool.query('UPDATE mnt_members SET is_active = ? WHERE user_id = ?', [b.is_active, b.user_id]);
  }
});

test('an admin can give a role to a person who already exists in core_users', async () => {
  const admin = await makeUser({ role: 'SYSADMIN' });
  const token = `ci-known-${randomUUID().slice(0, 8)}`;
  await call(token, 'POST', '/api/auth/sync'); // signs in once: core_users row, no member row
  const [[core]] = await pool.query('SELECT id FROM core_users WHERE firebase_uid = ?', [token]);
  extraUsers.push(core.id);

  const r = await call(await uid(admin), 'POST', '/api/admin/users',
    { name: 'Known Person', email: `${token}@test.local`, role: 'CLERICAL', department: 'Administration' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.user.id, core.id);
  assert.equal(r.body.user.role, 'CLERICAL');
  const again = await call(await uid(admin), 'POST', '/api/admin/users',
    { name: 'Known Person', email: `${token}@test.local`, role: 'CLERICAL', department: 'Administration' });
  assert.equal(again.status, 409);
});

test('editing a person writes identity to core_users and the role to mnt_members', async () => {
  const admin = await makeUser({ role: 'SYSADMIN' });
  const token = `ci-edit-${randomUUID().slice(0, 8)}`;
  await call(token, 'POST', '/api/auth/sync');
  const [[core]] = await pool.query('SELECT id FROM core_users WHERE firebase_uid = ?', [token]);
  extraUsers.push(core.id);

  const r = await call(await uid(admin), 'PATCH', `/api/admin/users/${core.id}`,
    { name: 'Renamed', phone: '9000000001', role: 'ACCOUNTANT', department: 'Administration' });
  assert.equal(r.status, 200, r.text);
  const [[c]] = await pool.query('SELECT name, phone FROM core_users WHERE id = ?', [core.id]);
  const [[m]] = await pool.query('SELECT role, department, is_active FROM mnt_members WHERE user_id = ?', [core.id]);
  assert.deepEqual([c.name, c.phone, m.role, m.department, m.is_active], ['Renamed', '9000000001', 'ACCOUNTANT', 'Administration', 1]);

  const off = await call(await uid(admin), 'PATCH', `/api/admin/users/${core.id}`, { is_active: false });
  assert.equal(off.status, 200, off.text);
  const [[c2]] = await pool.query('SELECT is_active FROM core_users WHERE id = ?', [core.id]);
  const [[m2]] = await pool.query('SELECT is_active FROM mnt_members WHERE user_id = ?', [core.id]);
  assert.deepEqual([c2.is_active, m2.is_active], [1, 0], 'the Sysadmin switch is module-level');
});

test('bootstrap-sysadmin run twice makes one user with the SYSADMIN role', async () => {
  const email = `ci-boot-${randomUUID().slice(0, 6)}@test.local`;
  const first = await bootstrapSysadmin(pool, { email, name: 'Boot Admin' });
  const second = await bootstrapSysadmin(pool, { email, name: 'Boot Admin' });
  extraUsers.push(first);
  assert.equal(first, second);
  const [rows] = await pool.query('SELECT role, is_active FROM mnt_users WHERE email = ?', [email]);
  assert.deepEqual(rows.map((r) => [r.role, r.is_active]), [['SYSADMIN', 1]]);
  await assert.rejects(() => bootstrapSysadmin(pool, { email: 'x@y.invalid', name: 'No' }), /\.invalid/);
  await assert.rejects(() => bootstrapSysadmin(pool, { email: '', name: 'No' }), /required/);
});

test('a bootstrapped sysadmin links to the Google account on first sign-in', async () => {
  const token = `ci-link-${randomUUID().slice(0, 8)}`;
  const id = await bootstrapSysadmin(pool, { email: `${token}@test.local`, name: 'Link Admin' });
  extraUsers.push(id);
  const r = await call(token, 'POST', '/api/auth/sync');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.user.id, id);
  assert.equal(r.body.user.role, 'SYSADMIN');
  assert.equal((await uid(id)), token);
});
