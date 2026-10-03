// Foundation guarantees of the database layer: every connection runs in UTC, and the
// migration runner refuses to turn a blank database into an install when told to expect one.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import '../../src/config/requireTestDb.js';
import mysql from 'mysql2/promise';
import pool from '../../src/config/db.js';
import { dbConfig, SESSION_INIT_SQL } from '../../src/config/dbConfig.js';
import { runMigrations } from '../../src/config/migrate.js';

after(() => pool.end());

test('pool connections are UTC even when the server runs in another zone', async () => {
  const [[row]] = await pool.query('SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS diff');
  assert.equal(Number(row.diff), 0);
});

test('a fresh runner connection is UTC too', async () => {
  const conn = await mysql.createConnection(dbConfig());
  try {
    await conn.query(SESSION_INIT_SQL);
    const [[row]] = await conn.query('SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS diff');
    assert.equal(Number(row.diff), 0);
  } finally {
    await conn.end();
  }
});

test('expect-existing guard refuses an empty database; without it the baseline is applied', async () => {
  const name = `${process.env.DB_NAME}_guard`;
  const admin = await mysql.createConnection({ ...dbConfig(), database: undefined });
  try {
    // Name always ends in _test (requireTestDb), so this can never touch a real database.
    await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
    await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await assert.rejects(
      runMigrations({ database: name, expectExisting: true }),
      /INFRA_EXPECT_EXISTING_DB/,
    );
    const [none] = await admin.query(
      'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [name]);
    assert.equal(none.length, 0, 'the refused boot must create nothing');

    await runMigrations({ database: name, expectExisting: false });
    const [tables] = await admin.query(
      'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [name]);
    assert.ok(tables[0].n >= 10);
    // Second boot with the guard on is fine: the tracking table exists.
    await runMigrations({ database: name, expectExisting: true });
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
    await admin.end();
  }
});
