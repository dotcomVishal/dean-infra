// O2 integration: the pure state machine (config/workflow.js) and the migrated
// schema must agree. A status the machine can produce but the ENUM rejects is a
// production 500 that no pure unit test can see.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS, ROLE, LOG_ACTION, DESK_RANK } from '../../src/config/workflow.js';
import pool from '../../src/config/db.js';
import { runMigrations } from '../../src/config/migrate.js';

after(() => pool.end());

async function enumValues(table, column) {
  const [[row]] = await pool.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [table, column]);
  assert.ok(row, `${table}.${column} missing -- migrations not applied?`);
  return [...row.t.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

test('tickets.status ENUM holds every STATUS the machine can produce', async () => {
  const db = await enumValues('infra_tickets', 'status');
  assert.deepEqual(Object.values(STATUS).filter((s) => !db.includes(s)), []);
});

test('users.role ENUM holds every ROLE', async () => {
  const db = await enumValues('infra_users', 'role');
  assert.deepEqual(Object.values(ROLE).filter((r) => !db.includes(r)), []);
});

test('audit_logs.action ENUM holds every LOG_ACTION', async () => {
  const db = await enumValues('infra_audit_logs', 'action');
  assert.deepEqual(Object.values(LOG_ACTION).filter((a) => !db.includes(a)), []);
});

test('every desk in the approval chain is a valid role', async () => {
  const roles = await enumValues('infra_users', 'role');
  assert.deepEqual(Object.keys(DESK_RANK).filter((d) => !roles.includes(d)), []);
});

test('all migrations are recorded as applied', async () => {
  const [rows] = await pool.query('SELECT filename FROM infra_schema_migrations ORDER BY filename');
  assert.ok(rows.some((r) => r.filename === '001_infra_baseline.sql'), 'baseline not recorded');
});

// ---- Baseline 001 -----------------------------------------------------------

test('baseline: running migrations again is a no-op', async () => {
  const [before] = await pool.query('SELECT COUNT(*) AS n FROM infra_schema_migrations');
  await runMigrations();
  await runMigrations();
  const [after_] = await pool.query('SELECT COUNT(*) AS n FROM infra_schema_migrations');
  assert.equal(after_[0].n, before[0].n);
});

test('baseline: the schema holds only infra_ tables, all utf8mb4_unicode_ci', async () => {
  const [rows] = await pool.query(
    `SELECT TABLE_NAME AS name, TABLE_COLLATION AS collation FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()`);
  assert.ok(rows.length > 0);
  assert.deepEqual(rows.filter((r) => !r.name.startsWith('infra_')).map((r) => r.name), []);
  assert.deepEqual(rows.filter((r) => r.collation !== 'utf8mb4_unicode_ci').map((r) => r.name), []);
});

test('baseline: no Clerical or Accountant role, no bills table', async () => {
  const roles = await enumValues('infra_users', 'role');
  assert.deepEqual(roles.filter((r) => r === 'CLERICAL' || r === 'ACCOUNTANT'), []);
  const [bills] = await pool.query(
    `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE '%bills%'`);
  assert.equal(bills.length, 0);
});

test('baseline: approval ceilings and the Dean and Director placeholders are seeded', async () => {
  const [limits] = await pool.query('SELECT `key` FROM infra_financial_limits ORDER BY `key`');
  assert.deepEqual(limits.map((l) => l.key), ['DEAN_APPROVE', 'DIRECT_AWARD', 'SE_APPROVE']);
  for (const role of ['DEAN', 'DIRECTOR']) {
    const [rows] = await pool.query('SELECT 1 FROM infra_users WHERE role = ? AND is_active = TRUE', [role]);
    assert.ok(rows.length >= 1, `no active ${role}`);
  }
});

test('ticket columns the code relies on exist', async () => {
  for (const c of ['assigned_ae_id', 'assigned_se_id', 'is_mock', 'status_changed_at']) {
    const [[row]] = await pool.query(
      `SELECT 1 AS ok FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'infra_tickets' AND COLUMN_NAME = ?`, [c]);
    assert.ok(row, `infra_tickets.${c} missing`);
  }
});
