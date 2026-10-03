// Development machines and tests must never reach a real database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertHostAllowed, assertTestDatabase } from '../../src/config/dbGuard.js';

function withEnv(env, fn) {
  const saved = { NODE_ENV: process.env.NODE_ENV };
  Object.assign(process.env, env);
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('outside production only local hosts are allowed', () => {
  withEnv({ NODE_ENV: 'development' }, () => {
    for (const h of ['localhost', '127.0.0.1', '::1']) assert.doesNotThrow(() => assertHostAllowed(h));
    assert.throws(() => assertHostAllowed('db.iitmandi.ac.in'), /Refusing to connect/);
    assert.throws(() => assertHostAllowed('mysql'), /Refusing to connect/);
  });
});

test('production allows any host', () => {
  withEnv({ NODE_ENV: 'production' }, () => assert.doesNotThrow(() => assertHostAllowed('db.iitmandi.ac.in')));
});

test('test guard needs NODE_ENV=test and a *_test database', () => {
  withEnv({ NODE_ENV: 'test' }, () => {
    assert.doesNotThrow(() => assertTestDatabase('x', 'infraseva_test'));
    assert.throws(() => assertTestDatabase('x', 'infraseva'), /refuses to run/);
    assert.throws(() => assertTestDatabase('x', undefined), /refuses to run/);
  });
  withEnv({ NODE_ENV: 'development' }, () => {
    assert.throws(() => assertTestDatabase('x', 'infraseva_test'), /refuses to run/);
  });
});
