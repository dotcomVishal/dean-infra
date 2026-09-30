// O2 integration: the pure state machine (config/workflow.js) and the migrated
// schema must agree. A status the machine can produce but the ENUM rejects is a
// production 500 that no pure unit test can see.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS, ROLE, LOG_ACTION, DESK_RANK } from '../../src/config/workflow.js';
import fs from 'fs';
import mysql from 'mysql2/promise';
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
  assert.ok(rows.length >= 8, `expected >= 8 applied migrations, got ${rows.length}`);
});

// ---- Migration 008 (plan2.md Phase 1) ----------------------------------------
const M008 = new URL('../../migrations/008_desk_assignees_and_mock.sql', import.meta.url);
const sql008 = fs.readFileSync(M008, 'utf8');
// Slice the DML sections so they can run inside a rolled-back transaction.
const section = (from, to) => sql008.slice(sql008.indexOf(from), sql008.indexOf(to));
const BACKFILL_SQL = section('-- 3. Backfill', '-- 4. Single');
const PLACEHOLDER_SQL = section('-- 4. Single', '-- PROVE IT WORKED');

async function columnInfo(table, column) {
  const [[row]] = await pool.query(
    `SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS def
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [table, column]);
  return row;
}

async function withTx(fn) {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'deanery_infra',
    multipleStatements: true,
  });
  try {
    await conn.beginTransaction();
    return await fn(conn);
  } finally {
    await conn.rollback();
    await conn.end();
  }
}

const activeHolders = async (conn, role) => (await conn.query(
  `SELECT email FROM users WHERE role = ? AND is_active = TRUE`, [role]))[0];

test('008: running migrations again is a no-op', async () => {
  const [before] = await pool.query('SELECT COUNT(*) AS n FROM schema_migrations');
  await runMigrations();
  await runMigrations();
  const [after_] = await pool.query('SELECT COUNT(*) AS n FROM schema_migrations');
  assert.equal(after_[0].n, before[0].n);
});

test('008: the SQL file is safe to re-run after it was applied', async () => {
  await withTx(async (conn) => { await conn.query(sql008); await conn.query(sql008); });
});

test('008: new columns exist with the expected type and default', async () => {
  for (const c of ['assigned_ae_id', 'assigned_se_id']) {
    const info = await columnInfo('tickets', c);
    assert.ok(info, `tickets.${c} missing`);
    assert.equal(info.nullable, 'YES');
  }
  const mock = await columnInfo('tickets', 'is_mock');
  assert.equal(mock.def, '0');
  assert.equal(mock.nullable, 'NO');
  const self = await columnInfo('audit_logs', 'is_self_action');
  assert.equal(self.def, '0');
  assert.equal(self.nullable, 'NO');
});

test('008: foreign keys and indexes exist', async () => {
  const [fks] = await pool.query(
    `SELECT CONSTRAINT_NAME AS n FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tickets' AND CONSTRAINT_TYPE = 'FOREIGN KEY'`);
  const [idx] = await pool.query(
    `SELECT DISTINCT INDEX_NAME AS n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tickets'`);
  const fk = fks.map((r) => r.n);
  const ix = idx.map((r) => r.n);
  for (const n of ['fk_tickets_assigned_ae', 'fk_tickets_assigned_se']) assert.ok(fk.includes(n), n);
  for (const n of ['idx_assigned_ae', 'idx_assigned_se', 'idx_is_mock']) assert.ok(ix.includes(n), n);
});

test('008: backfill pins AE and SE for tickets sitting at that desk, only once', async () => {
  await withTx(async (conn) => {
    const mk = async (role) => (await conn.query(
      `INSERT INTO users (firebase_uid, name, email, role, department, is_active)
       VALUES (?, ?, ?, ?, 'Administration', TRUE)`,
      [`ci-bf-${role}`, `CI ${role}`, `ci-bf-${role}@test.local`, role]))[0].insertId;
    const applicant = await mk('APPLICANT');
    const ae = await mk('AE');
    const se = await mk('SE');
    const tk = async (status, desk) => (await conn.query(
      `INSERT INTO tickets (applicant_id, department, campus, description, status, current_desk_user_id)
       VALUES (?, 'Civil', 'NORTH', 'ci backfill', ?, ?)`, [applicant, status, desk]))[0].insertId;
    const atAe = await tk('PENDING_AE_APPROVAL', ae);
    const atSe = await tk('PENDING_SE_APPROVAL', se);
    const past = await tk('PENDING_DEAN_APPROVAL', se);

    await conn.query(BACKFILL_SQL);
    await conn.query(BACKFILL_SQL); // second run changes nothing
    const [rows] = await conn.query(
      'SELECT id, assigned_ae_id AS ae, assigned_se_id AS se FROM tickets WHERE id IN (?)', [[atAe, atSe, past]]);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(by[atAe].ae, ae);
    assert.equal(by[atSe].se, se);
    assert.equal(by[past].ae, null);
    assert.equal(by[past].se, null);
  });
});

for (const [role, email] of [['DEAN', 'dean@placeholder.invalid'], ['DIRECTOR', 'director@placeholder.invalid']]) {
  test(`008: no active ${role} -> exactly one placeholder, stable on re-run`, async () => {
    await withTx(async (conn) => {
      await conn.query(`UPDATE users SET is_active = FALSE WHERE role = ?`, [role]);
      await conn.query(`DELETE FROM users WHERE email = ?`, [email]);
      await conn.query(PLACEHOLDER_SQL);
      await conn.query(PLACEHOLDER_SQL);
      const holders = await activeHolders(conn, role);
      assert.deepEqual(holders.map((h) => h.email), [email]);
    });
  });

  test(`008: real active ${role} -> no placeholder inserted`, async () => {
    await withTx(async (conn) => {
      await conn.query(`DELETE FROM users WHERE email = ?`, [email]);
      await conn.query(`UPDATE users SET is_active = FALSE WHERE role = ?`, [role]);
      await conn.query(
        `INSERT INTO users (firebase_uid, name, email, role, department, is_active)
         VALUES ('ci-real-holder', 'Real', 'ci-real-holder@test.local', ?, 'Administration', TRUE)`, [role]);
      await conn.query(PLACEHOLDER_SQL);
      const [rows] = await conn.query('SELECT 1 FROM users WHERE email = ?', [email]);
      assert.equal(rows.length, 0);
      assert.equal((await activeHolders(conn, role)).length, 1);
    });
  });

  test(`008: inactive ${role} placeholder is reactivated when no holder is active`, async () => {
    await withTx(async (conn) => {
      await conn.query(`UPDATE users SET is_active = FALSE WHERE role = ?`, [role]);
      await conn.query(`DELETE FROM users WHERE email = ?`, [email]);
      await conn.query(
        `INSERT INTO users (firebase_uid, name, email, role, department, is_active)
         VALUES (?, 'old placeholder', ?, ?, 'Administration', FALSE)`, [`ci-ph-${role}`, email, role]);
      await conn.query(PLACEHOLDER_SQL);
      assert.deepEqual((await activeHolders(conn, role)).map((h) => h.email), [email]);
    });
  });
}
