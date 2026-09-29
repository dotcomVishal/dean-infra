// O2 integration: the pure state machine (config/workflow.js) and the migrated
// schema must agree. A status the machine can produce but the ENUM rejects is a
// production 500 that no pure unit test can see.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS, ROLE, LOG_ACTION, DESK_RANK } from '../../src/config/workflow.js';
import pool from '../../src/config/db.js';

after(() => pool.end());

async function enumValues(table, column) {
  const [[row]] = await pool.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [table, column]);
  assert.ok(row, `${table}.${column} missing -- migrations not applied?`);
  return [...row.t.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

test('tickets.status ENUM holds every STATUS the machine can produce', async () => {
  const db = await enumValues('tickets', 'status');
  assert.deepEqual(Object.values(STATUS).filter((s) => !db.includes(s)), []);
});

test('users.role ENUM holds every ROLE', async () => {
  const db = await enumValues('users', 'role');
  assert.deepEqual(Object.values(ROLE).filter((r) => !db.includes(r)), []);
});

test('audit_logs.action ENUM holds every LOG_ACTION', async () => {
  const db = await enumValues('audit_logs', 'action');
  assert.deepEqual(Object.values(LOG_ACTION).filter((a) => !db.includes(a)), []);
});

test('every desk in the approval chain is a valid role', async () => {
  const roles = await enumValues('users', 'role');
  assert.deepEqual(Object.keys(DESK_RANK).filter((d) => !roles.includes(d)), []);
});

test('all migrations are recorded as applied', async () => {
  const [rows] = await pool.query('SELECT filename FROM schema_migrations ORDER BY filename');
  assert.ok(rows.length >= 6, `expected >= 6 applied migrations, got ${rows.length}`);
});
