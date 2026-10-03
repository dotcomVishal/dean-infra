// X8 / P2: the general limit is per person (behind requireAuth), not one bucket per IP.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import app from '../../src/app.js';
import { auth } from '../../src/config/firebase.js';
import { makeUser, cleanup, pool } from './helpers.mjs';

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

const uid = async (id) => (await pool.query('SELECT firebase_uid FROM infra_users WHERE id = ?', [id]))[0][0].firebase_uid;
const hit = async (token) => (await fetch(`${base}/api/tickets/applicant`, { headers: { Authorization: `Bearer ${token}` } })).status;

test('one busy user is limited without limiting anybody else from the same IP', async () => {
  const a = await uid(await makeUser({ role: 'APPLICANT' }));
  const b = await uid(await makeUser({ role: 'APPLICANT' }));
  let last = 200;
  for (let i = 0; i < 601; i += 1) last = await hit(a);
  assert.equal(last, 429, 'user A is limited after 600 requests');
  assert.equal(await hit(b), 200, 'user B, same IP, is unaffected');
});
