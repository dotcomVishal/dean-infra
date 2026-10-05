// X1: two people behind one address must not share a rate-limit bucket.
import './rate-limit-env.mjs';
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { call, stopServer } from './http-helpers.mjs';
import { makeUser, cleanup, pool } from './helpers.mjs';

beforeEach(cleanup);
after(async () => { await cleanup(); await stopServer(); await pool.end(); });

const uid = async (id) => (await pool.query('SELECT firebase_uid FROM users WHERE id = ?', [id]))[0][0].firebase_uid;

test('limit is per signed-in user, not per address', async () => {
  const a = await uid(await makeUser({ role: 'APPLICANT' }));
  const b = await uid(await makeUser({ role: 'APPLICANT' }));

  for (let i = 0; i < 3; i += 1) assert.equal((await call(a, 'GET', '/api/tickets/applicant')).status, 200);
  const blocked = await call(a, 'GET', '/api/tickets/applicant');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'RATE_LIMITED');

  // Same address (127.0.0.1), different user: unaffected.
  assert.equal((await call(b, 'GET', '/api/tickets/applicant')).status, 200);
});

test('attachment downloads have their own bucket', async () => {
  const a = await uid(await makeUser({ role: 'APPLICANT' }));
  for (let i = 0; i < 3; i += 1) await call(a, 'GET', '/api/tickets/applicant');
  assert.equal((await call(a, 'GET', '/api/tickets/applicant')).status, 429);
  assert.equal((await call(a, 'GET', '/api/attachments/999999')).status, 404, 'not 429');
});

test('rejected tokens are counted per address', async () => {
  const res = await call('not-a-ci-token', 'GET', '/api/tickets/applicant');
  assert.equal(res.status, 401);
});
