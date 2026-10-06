// S12: raw SQL / Firebase errors must never reach the client; the client gets a
// generic message + request id, and the detail goes to the structured log.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { requestId } from '../../src/middleware/requestId.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { sendServerError, GENERIC_MESSAGE } from '../../src/utils/httpError.js';
import { WorkflowError } from '../../src/config/workflow.js';
import { logger, errorFields } from '../../src/utils/logger.js';

const SQL_ERROR = Object.assign(
  new Error("Table 'infraseva.mnt_tickets' doesn't exist"),
  { code: 'ER_NO_SUCH_TABLE', errno: 1146, sqlState: '42S02', sqlMessage: "Table 'infraseva.mnt_tickets' doesn't exist" });
const FIREBASE_ERROR = Object.assign(
  new Error('Firebase ID token has expired. Get a fresh ID token from your client app'),
  { code: 'auth/id-token-expired' });

async function withApp(setup, fn) {
  const app = express();
  app.use(requestId);
  app.use(express.json());
  setup(app);
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

test('async handler throwing a SQL error -> generic 500 + request id, no SQL text', async () => {
  await withApp((app) => app.get('/boom', async () => { throw SQL_ERROR; }), async (base) => {
    const res = await fetch(`${base}/boom`);
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.equal(body.message, GENERIC_MESSAGE);
    assert.equal(body.requestId, res.headers.get('x-request-id'));
    assert.match(body.requestId, /^[0-9a-f-]{36}$/);
    const raw = JSON.stringify(body);
    for (const leak of ['infraseva', 'ER_NO_SUCH_TABLE', '42S02', 'mnt_tickets']) {
      assert.ok(!raw.includes(leak), `response leaked ${leak}`);
    }
  });
});

test('sendServerError masks a Firebase error', async () => {
  await withApp((app) => app.get('/fb', (req, res) => sendServerError(req, res, FIREBASE_ERROR, 'fb')), async (base) => {
    const res = await fetch(`${base}/fb`);
    const raw = await res.text();
    assert.equal(res.status, 500);
    assert.ok(!raw.includes('Firebase') && !raw.includes('auth/'), raw);
  });
});

test('every request gets its own id; a caller-supplied X-Request-Id is ignored', async () => {
  await withApp((app) => app.get('/ok', (_req, res) => res.json({ ok: true })), async (base) => {
    const a = await fetch(`${base}/ok`, { headers: { 'X-Request-Id': 'forged-id' } });
    const b = await fetch(`${base}/ok`);
    assert.notEqual(a.headers.get('x-request-id'), 'forged-id');
    assert.notEqual(a.headers.get('x-request-id'), b.headers.get('x-request-id'));
  });
});

test('WorkflowError keeps its status, code and message (safe by construction)', async () => {
  await withApp((app) => app.get('/wf', () => { throw new WorkflowError('Nope', { code: 'X', status: 409 }); }), async (base) => {
    const res = await fetch(`${base}/wf`);
    const body = await res.json();
    assert.equal(res.status, 409);
    assert.equal(body.code, 'X');
    assert.equal(body.message, 'Nope');
    assert.ok(body.requestId);
  });
});

test('malformed JSON body -> 400, not 500', async () => {
  await withApp((app) => app.post('/j', (_req, res) => res.json({})), async (base) => {
    const res = await fetch(`${base}/j`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    assert.equal(res.status, 400);
    assert.ok((await res.json()).requestId);
  });
});

test('logger writes one JSON line carrying the SQL detail (internal only)', () => {
  const lines = [];
  const orig = process.stderr.write;
  const prev = process.env.LOG_IN_TEST;
  process.env.LOG_IN_TEST = '1';
  process.stderr.write = (c) => { lines.push(String(c)); return true; };
  try {
    logger.error('unit', { requestId: 'r1', ...errorFields(SQL_ERROR) });
  } finally {
    process.stderr.write = orig;
    if (prev === undefined) delete process.env.LOG_IN_TEST; else process.env.LOG_IN_TEST = prev;
  }
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.level, 'error');
  assert.equal(rec.requestId, 'r1');
  assert.equal(rec.error.code, 'ER_NO_SUCH_TABLE');
  assert.equal(rec.error.sqlState, '42S02');
});
