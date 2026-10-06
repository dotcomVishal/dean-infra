// O2 integration: the pure state machine (config/workflow.js) and the migrated
// schema must agree. A status the machine can produce but the ENUM rejects is a
// production 500 that no pure unit test can see.
import './guard.mjs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS, ROLE, LOG_ACTION, DESK_RANK } from '../../src/config/workflow.js';
import fs from 'fs';
import mysql from 'mysql2/promise';
import pool from '../../src/config/db.js';
import { openConnection } from '../../src/config/dbOptions.js';
import { insertUser, setRoleActive } from './helpers.mjs';
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
  const db = await enumValues('mnt_tickets', 'status');
  assert.deepEqual(Object.values(STATUS).filter((s) => !db.includes(s)), []);
});

test('mnt_members.role ENUM holds every ROLE', async () => {
  const db = await enumValues('mnt_members', 'role');
  assert.deepEqual(Object.values(ROLE).filter((r) => !db.includes(r)), []);
});

test('audit_logs.action ENUM holds every LOG_ACTION', async () => {
  const db = await enumValues('mnt_audit_logs', 'action');
  assert.deepEqual(Object.values(LOG_ACTION).filter((a) => !db.includes(a)), []);
});

test('every desk in the approval chain is a valid role', async () => {
  const roles = await enumValues('mnt_members', 'role');
  assert.deepEqual(Object.keys(DESK_RANK).filter((d) => !roles.includes(d)), []);
});

test('all migrations are recorded as applied', async () => {
  const [rows] = await pool.query('SELECT filename FROM mnt_schema_migrations ORDER BY filename');
  assert.ok(rows.length >= 1, `expected >= 1 applied migration, got ${rows.length}`);
});

// ---- Baseline: placeholders and schema shape ---------------------------------
const BASELINE = new URL('../../migrations/mnt/001_baseline.sql', import.meta.url);
const sqlBaseline = fs.readFileSync(BASELINE, 'utf8');
// Slice the placeholder DML so it can run inside a rolled-back transaction.
const PLACEHOLDER_SQL = sqlBaseline.slice(sqlBaseline.indexOf('-- Single Dean / Director placeholders'));

async function columnInfo(table, column) {
  const [[row]] = await pool.query(
    `SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS def
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [table, column]);
  return row;
}

async function withTx(fn) {
  const conn = await openConnection(mysql, { multipleStatements: true });
  try {
    await conn.beginTransaction();
    return await fn(conn);
  } finally {
    await conn.rollback();
    await conn.end();
  }
}

const activeHolders = async (conn, role) => (await conn.query(
  `SELECT email FROM mnt_users WHERE role = ? AND is_active = TRUE`, [role]))[0];

test('running migrations again is a no-op', async () => {
  const [before] = await pool.query('SELECT COUNT(*) AS n FROM mnt_schema_migrations');
  await runMigrations();
  await runMigrations();
  const [after_] = await pool.query('SELECT COUNT(*) AS n FROM mnt_schema_migrations');
  assert.equal(after_[0].n, before[0].n);
});

test('the baseline is safe to re-run after it was applied', async () => {
  await withTx(async (conn) => { await conn.query(sqlBaseline); await conn.query(sqlBaseline); });
});

test('baseline: new columns exist with the expected type and default', async () => {
  for (const c of ['assigned_ae_id', 'assigned_se_id']) {
    const info = await columnInfo('mnt_tickets', c);
    assert.ok(info, `tickets.${c} missing`);
    assert.equal(info.nullable, 'YES');
  }
  const mock = await columnInfo('mnt_tickets', 'is_mock');
  assert.equal(mock.def, '0');
  assert.equal(mock.nullable, 'NO');
  const self = await columnInfo('mnt_audit_logs', 'is_self_action');
  assert.equal(self.def, '0');
  assert.equal(self.nullable, 'NO');
});

test('baseline: foreign keys and indexes exist', async () => {
  const [fks] = await pool.query(
    `SELECT CONSTRAINT_NAME AS n FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mnt_tickets' AND CONSTRAINT_TYPE = 'FOREIGN KEY'`);
  const [idx] = await pool.query(
    `SELECT DISTINCT INDEX_NAME AS n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mnt_tickets'`);
  const fk = fks.map((r) => r.n);
  const ix = idx.map((r) => r.n);
  for (const n of ['fk_mnt_tickets_assigned_ae', 'fk_mnt_tickets_assigned_se']) assert.ok(fk.includes(n), n);
  for (const n of ['idx_assigned_ae', 'idx_assigned_se', 'idx_is_mock']) assert.ok(ix.includes(n), n);
});

for (const [role, email] of [['DEAN', 'dean@placeholder.invalid'], ['DIRECTOR', 'director@placeholder.invalid']]) {
  test(`baseline: no active ${role} -> exactly one placeholder, stable on re-run`, async () => {
    await withTx(async (conn) => {
      await setRoleActive(role, false, conn);
      await conn.query('DELETE FROM core_users WHERE email = ?', [email]);
      await conn.query(PLACEHOLDER_SQL);
      await conn.query(PLACEHOLDER_SQL);
      const holders = await activeHolders(conn, role);
      assert.deepEqual(holders.map((h) => h.email), [email]);
    });
  });

  test(`baseline: real active ${role} -> no placeholder inserted`, async () => {
    await withTx(async (conn) => {
      await conn.query('DELETE FROM core_users WHERE email = ?', [email]);
      await setRoleActive(role, false, conn);
      await insertUser(conn, { firebaseUid: 'ci-real-holder', name: 'Real', email: 'ci-real-holder@test.local', role });
      await conn.query(PLACEHOLDER_SQL);
      const [rows] = await conn.query('SELECT 1 FROM core_users WHERE email = ?', [email]);
      assert.equal(rows.length, 0);
      assert.equal((await activeHolders(conn, role)).length, 1);
    });
  });

  test(`baseline: inactive ${role} placeholder is reactivated when no holder is active`, async () => {
    await withTx(async (conn) => {
      await setRoleActive(role, false, conn);
      await conn.query('DELETE FROM core_users WHERE email = ?', [email]);
      await insertUser(conn, { firebaseUid: `ci-ph-${role}`, name: 'old placeholder', email, role, isActive: false });
      await conn.query(PLACEHOLDER_SQL);
      assert.deepEqual((await activeHolders(conn, role)).map((h) => h.email), [email]);
    });
  });

  test(`baseline: a placeholder with no member row gets one, with the ${role} role`, async () => {
    await withTx(async (conn) => {
      await setRoleActive(role, false, conn);
      await conn.query('DELETE FROM core_users WHERE email = ?', [email]);
      await conn.query(
        'INSERT INTO core_users (firebase_uid, name, email, is_active) VALUES (?, ?, ?, TRUE)', [`ci-ph2-${role}`, 'half placeholder', email]);
      await conn.query(PLACEHOLDER_SQL);
      assert.deepEqual((await activeHolders(conn, role)).map((h) => h.email), [email]);
    });
  });
}
