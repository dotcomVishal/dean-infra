// The baseline is written to be re-runnable: a crash mid-file must be safe to repeat,
// and a second run must change nothing.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import mysql from 'mysql2/promise';
import { pool } from './helpers.mjs';
import { openConnection } from '../../src/config/dbOptions.js';

after(async () => { await pool.end(); });

const open = () => openConnection(mysql, { multipleStatements: true });
const sqlOf = (file) => fs.readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');

test('mnt/001_baseline.sql: running the file again changes nothing and does not fail', async () => {
  const conn = await open();
  try {
    const count = async () => (await conn.query('SELECT COUNT(*) AS n FROM mnt_users'))[0][0].n;
    const before = await count();
    await conn.query(sqlOf('mnt/001_baseline.sql'));
    await conn.query(sqlOf('mnt/001_baseline.sql'));
    assert.equal(await count(), before);
  } finally { await conn.end(); }
});

test('amount columns hold 15 digits', async () => {
  for (const [table, column] of [['mnt_reports', 'estimated_amount'], ['mnt_tenders', 'work_order_value'], ['mnt_bills', 'net_amount'], ['mnt_financial_limits', 'max_amount']]) {
    const [[row]] = await pool.query(
      'SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [table, column]);
    assert.equal(row.t, 'decimal(15,2)', `${table}.${column}`);
  }
});

test('the four financial limits are seeded', async () => {
  const [rows] = await pool.query('SELECT `key`, max_amount FROM mnt_financial_limits ORDER BY `key`');
  assert.deepEqual(rows.map((r) => [r.key, Number(r.max_amount)]), [
    ['DEAN_APPROVE', 500000], ['DEAN_HIGH_VALUE', 200000], ['DIRECT_AWARD', 10000], ['SE_APPROVE', 50000]]);
});
