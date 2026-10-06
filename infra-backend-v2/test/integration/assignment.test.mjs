// O2 integration: services/assignment.js against a real MySQL (SKIP LOCKED needs one).
//   unavailable JE skipped . BOTH scope matched . other campus not matched .
//   least-loaded wins . tie -> round robin . nobody -> UNASSIGNED at the same-campus AE .
//   concurrent picks never land on the same JE.
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pickAvailableJe, assignTicket } from '../../src/services/assignment.js';
import { DEPT, makeUser, makeOpenTicket, putOnLeave, inRolledBackTx, cleanup, pool } from './helpers.mjs';

// Each test gets a clean roster in the Administration scope.
beforeEach(cleanup);
after(async () => { await cleanup(); await pool.end(); });

const pick = (campus) => inRolledBackTx((c) => pickAvailableJe(c, { department: DEPT, campus }));

test('JE whose scope matches the campus is picked', async () => {
  const north = await makeUser({ role: 'JE', campus: 'NORTH', scopes: ['NORTH'] });
  assert.equal((await pick('NORTH'))?.id, north);
});

test('a JE scoped to the other campus is NOT picked', async () => {
  await makeUser({ role: 'JE', campus: 'SOUTH', scopes: ['SOUTH'] });
  assert.equal(await pick('NORTH'), null);
});

test('BOTH-campus JE serves either campus', async () => {
  const both = await makeUser({ role: 'JE', campus: 'BOTH', scopes: ['BOTH'] });
  assert.equal((await pick('NORTH'))?.id, both);
  assert.equal((await pick('SOUTH'))?.id, both);
});

test('JE on leave is skipped', async () => {
  const away = await makeUser({ role: 'JE', campus: 'NORTH', scopes: ['NORTH'] });
  const here = await makeUser({ role: 'JE', campus: 'NORTH', scopes: ['NORTH'] });
  await putOnLeave(away, here);
  assert.equal((await pick('NORTH'))?.id, here);
});

test('inactive JE is skipped', async () => {
  const off = await makeUser({ role: 'JE', campus: 'NORTH', scopes: ['NORTH'] });
  await pool.query('UPDATE core_users SET is_active = FALSE WHERE id = ?', [off]);
  assert.equal(await pick('NORTH'), null);
});

test('least-loaded JE wins over an earlier id', async () => {
  const busy = await makeUser({ role: 'JE', campus: 'NORTH', scopes: ['NORTH'] });
  const idle = await makeUser({ role: 'JE', campus: 'NORTH', scopes: ['NORTH'] });
  const applicant = await makeUser({ role: 'APPLICANT' });
  await makeOpenTicket(applicant, busy);
  await makeOpenTicket(applicant, busy, 'RETURNED_TO_JE'); // also counts as open with the JE
  assert.equal((await pick('NORTH'))?.id, idle);
});

test('tickets already past the JE do not count as load', async () => {
  const first = await makeUser({ role: 'JE', campus: 'NORTH', scopes: ['NORTH'] });
  await makeUser({ role: 'JE', campus: 'NORTH', scopes: ['NORTH'] });
  const applicant = await makeUser({ role: 'APPLICANT' });
  await makeOpenTicket(applicant, first, 'PENDING_AE_APPROVAL');
  await makeOpenTicket(applicant, first, 'CLOSED');
  assert.equal((await pick('NORTH'))?.id, first, 'equal load (0 vs 0) -> lowest id');
});

test('tie is broken by round robin (last_assigned_at), then id', async () => {
  const a = await makeUser({ role: 'JE', campus: 'NORTH', scopes: ['NORTH'] });
  const b = await makeUser({ role: 'JE', campus: 'NORTH', scopes: ['NORTH'] });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const first = await assignTicket(conn, { department: DEPT, campus: 'NORTH' });
    await conn.commit(); // commits the last_assigned_at bump so the next pick sees it
    await conn.beginTransaction();
    const second = await assignTicket(conn, { department: DEPT, campus: 'NORTH' });
    await conn.commit();
    await conn.beginTransaction();
    const third = await assignTicket(conn, { department: DEPT, campus: 'NORTH' });
    await conn.commit();
    assert.deepEqual([first, second, third].map((r) => r.assignedJeId), [a, b, a]);
    assert.ok([first, second, third].every((r) => r.status === 'ASSIGNED_TO_JE'));
  } finally {
    conn.release();
  }
});

test('nobody available -> UNASSIGNED at the same-campus AE, never the other campus', async () => {
  const je = await makeUser({ role: 'JE', campus: 'NORTH', scopes: ['NORTH'] });
  const aeNorth = await makeUser({ role: 'AE', campus: 'NORTH', scopes: ['NORTH'] });
  await makeUser({ role: 'AE', campus: 'SOUTH', scopes: ['SOUTH'] });
  await putOnLeave(je, aeNorth);
  const out = await inRolledBackTx((c) => assignTicket(c, { department: DEPT, campus: 'NORTH' }));
  assert.equal(out.status, 'UNASSIGNED');
  assert.equal(out.assignedJeId, null);
  assert.equal(out.currentDeskUserId, aeNorth);
});

test('concurrent picks in open transactions land on different JEs (SKIP LOCKED)', async () => {
  const a = await makeUser({ role: 'JE', campus: 'NORTH', scopes: ['NORTH'] });
  const b = await makeUser({ role: 'JE', campus: 'NORTH', scopes: ['NORTH'] });
  const c1 = await pool.getConnection();
  const c2 = await pool.getConnection();
  try {
    await c1.beginTransaction();
    await c2.beginTransaction();
    const [j1, j2] = await Promise.all([
      pickAvailableJe(c1, { department: DEPT, campus: 'NORTH' }),
      pickAvailableJe(c2, { department: DEPT, campus: 'NORTH' }),
    ]);
    assert.ok(j1 && j2, 'both transactions get a JE');
    assert.notEqual(j1.id, j2.id, 'same JE double-booked');
    assert.deepEqual([j1.id, j2.id].sort((x, y) => x - y), [a, b]);
    // A third concurrent pick finds every candidate locked and gets nobody, not a duplicate.
    const c3 = await pool.getConnection();
    try {
      await c3.beginTransaction();
      assert.equal(await pickAvailableJe(c3, { department: DEPT, campus: 'NORTH' }), null);
    } finally { await c3.rollback(); c3.release(); }
  } finally {
    await c1.rollback(); await c2.rollback(); c1.release(); c2.release();
  }
});
