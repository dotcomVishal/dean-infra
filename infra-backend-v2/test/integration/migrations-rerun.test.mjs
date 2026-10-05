// Migrations 010-013 are additive and re-runnable (a crash mid-file must be safe to repeat),
// and 013 repairs a ticket foreign key whose delete rule is not CASCADE.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import mysql from 'mysql2/promise';
import { pool } from './helpers.mjs';

after(async () => { await pool.end(); });

const open = () => mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'deanery_infra',
  multipleStatements: true,
});
const sqlOf = (file) => fs.readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');

for (const file of [
  '010_attachment_attribution.sql', '011_notifications_digest.sql', '012_tender_lifecycle.sql', '013_ticket_deletions.sql',
]) {
  test(`${file}: running the file again changes nothing and does not fail`, async () => {
    const conn = await open();
    try {
      await conn.query(sqlOf(file));
      await conn.query(sqlOf(file));
    } finally { await conn.end(); }
  });
}

test('013: a ticket foreign key that does not cascade is recreated as CASCADE', async () => {
  const rule = async () => (await pool.query(
    `SELECT rc.DELETE_RULE AS r, rc.CONSTRAINT_NAME AS name FROM information_schema.REFERENTIAL_CONSTRAINTS rc
      WHERE rc.CONSTRAINT_SCHEMA = DATABASE() AND rc.TABLE_NAME = 'bills' AND rc.REFERENCED_TABLE_NAME = 'tickets'`))[0];
  const [before] = await rule();
  const conn = await open();
  try {
    await conn.query(`ALTER TABLE bills DROP FOREIGN KEY ${before.name}`);
    await conn.query(`ALTER TABLE bills ADD CONSTRAINT ${before.name} FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE RESTRICT`);
    assert.equal((await rule())[0].r, 'RESTRICT');
    await conn.query(sqlOf('013_ticket_deletions.sql'));
  } finally { await conn.end(); }
  const after_ = await rule();
  assert.equal(after_.length, 1, 'exactly one ticket key on bills');
  assert.equal(after_[0].r, 'CASCADE');
});

test('012: amount columns hold 15 digits', async () => {
  for (const [table, column] of [['reports', 'estimated_amount'], ['tenders', 'work_order_value'], ['bills', 'net_amount'], ['financial_limits', 'max_amount']]) {
    const [[row]] = await pool.query(
      'SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [table, column]);
    assert.equal(row.t, 'decimal(15,2)', `${table}.${column}`);
  }
});
