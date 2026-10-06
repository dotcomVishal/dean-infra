// A2/A3: a stale or fallback desk owner is re-resolved to the real one.
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveOwnerId, getEligibleJe, resolveAeForScope } from '../../src/models/deskModel.js';
import { DEPT, makeUser, cleanup, pool } from './helpers.mjs';

beforeEach(cleanup);
after(async () => { await cleanup(); await pool.end(); });

const tk = (stored, campus = 'NORTH') => ({ department: DEPT, campus, assigned_je_id: null, current_desk_user_id: stored });
const owner = (t) => effectiveOwnerId(pool, t, 'AE');

test('SYSADMIN fallback owner is replaced once an in-scope AE exists', async () => {
  const admin = await makeUser({ role: 'SYSADMIN' });
  assert.equal(await owner(tk(admin)), admin); // nobody else yet: keep stored
  const ae = await makeUser({ role: 'AE', campus: 'NORTH', scopes: ['NORTH'] });
  assert.equal(await owner(tk(admin)), ae);
});

test('AE of the other campus is replaced by the right campus AE', async () => {
  const south = await makeUser({ role: 'AE', campus: 'SOUTH', scopes: ['SOUTH'] });
  const north = await makeUser({ role: 'AE', campus: 'NORTH', scopes: ['NORTH'] });
  assert.equal(await owner(tk(south)), north);
});

test('valid stored owner is kept; deactivated one is replaced', async () => {
  const a = await makeUser({ role: 'AE', campus: 'NORTH', scopes: ['NORTH'] });
  const b = await makeUser({ role: 'AE', campus: 'NORTH', scopes: ['NORTH'] });
  assert.equal(await owner(tk(b)), b);
  await pool.query('UPDATE mnt_users SET is_active = FALSE WHERE id = ?', [b]);
  assert.equal(await owner(tk(b)), a);
});

test('C1: JE of the wrong campus is not eligible; BOTH and null campus are', async () => {
  const north = await makeUser({ role: 'JE', campus: 'NORTH', scopes: ['NORTH'] });
  const both = await makeUser({ role: 'JE', scopes: ['BOTH'] });
  assert.equal((await getEligibleJe(pool, north, DEPT, 'SOUTH')), null);
  assert.equal((await getEligibleJe(pool, north, DEPT, 'NORTH')).id, north);
  assert.equal((await getEligibleJe(pool, both, DEPT, 'SOUTH')).id, both);
  assert.equal((await getEligibleJe(pool, north, DEPT, null)).id, north);
});

test('C3: second AE gets the ticket when the first is loaded', async () => {
  const a = await makeUser({ role: 'AE', campus: 'NORTH', scopes: ['NORTH'] });
  const b = await makeUser({ role: 'AE', campus: 'NORTH', scopes: ['NORTH'] });
  const scope = { department: DEPT, campus: 'NORTH' };
  assert.equal((await resolveAeForScope(pool, scope)).id, a); // tie -> lowest id
  const applicant = await makeUser({ role: 'APPLICANT' });
  const [r] = await pool.query(
    `INSERT INTO mnt_tickets (applicant_id, department, campus, description, status, current_desk_user_id)
     VALUES (?, 'Civil', 'NORTH', 'ci load', 'UNASSIGNED', ?)`, [applicant, a]);
  try {
    assert.equal((await resolveAeForScope(pool, scope)).id, b);
  } finally {
    await pool.query('DELETE FROM mnt_tickets WHERE id = ?', [r.insertId]);
  }
});
