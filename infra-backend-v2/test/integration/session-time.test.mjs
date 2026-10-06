// The college MySQL server runs in IST while the application stores UTC. Every
// connection must carry the session time zone, or NOW() and UTC values written by
// the application disagree by 5 h 30 min with no error.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { pool } from './helpers.mjs';
import { openConnection } from '../../src/config/dbOptions.js';

after(async () => { await pool.end(); });

test('every pool connection has NOW() equal to UTC_TIMESTAMP()', async () => {
  // More connections than the pool opens by default, so freshly opened ones are covered.
  const conns = await Promise.all(Array.from({ length: 8 }, () => pool.getConnection()));
  try {
    for (const c of conns) {
      const [[row]] = await c.query('SELECT NOW() = UTC_TIMESTAMP() AS same, @@session.time_zone AS tz');
      assert.equal(row.same, 1);
      assert.equal(row.tz, '+00:00');
    }
  } finally { for (const c of conns) c.release(); }
});

test('a migration connection has NOW() equal to UTC_TIMESTAMP()', async () => {
  const conn = await openConnection(mysql, { multipleStatements: true });
  try {
    const [[row]] = await conn.query('SELECT NOW() = UTC_TIMESTAMP() AS same');
    assert.equal(row.same, 1);
  } finally { await conn.end(); }
});

test('sql_mode is strict on every connection', async () => {
  const [[row]] = await pool.query('SELECT @@session.sql_mode AS m');
  assert.match(row.m, /STRICT_TRANS_TABLES/);
});
