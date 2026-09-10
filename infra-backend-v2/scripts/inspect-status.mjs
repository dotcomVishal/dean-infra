// READ-ONLY diagnostic. Changes nothing. Run before any migration.
import 'dotenv/config';
import pool from '../src/config/db.js';
import { STATUS, LOG_ACTION } from '../src/config/workflow.js';

// ---- pure logic, so it can be tested without a database --------------------
export function audit(found, legal) {
  const legalSet = new Set(legal);
  const illegal  = found.filter(r => !legalSet.has(r.value));
  const unused   = legal.filter(v => !found.some(r => r.value === v));
  return { illegal, unused, rows: found.reduce((s, r) => s + r.count, 0) };
}

export function render(label, columnType, res) {
  const out = [`\n--- ${label} ---`, `  column type : ${columnType}`];
  out.push(`  rows        : ${res.rows}`);
  if (res.illegal.length) {
    out.push(`  ILLEGAL VALUES (${res.illegal.length}) -- these will be BLANKED by an ALTER:`);
    for (const r of res.illegal) out.push(`      ${JSON.stringify(r.value)}  x${r.count}`);
  } else {
    out.push('  illegal     : none');
  }
  if (res.unused.length) out.push(`  legal-but-unused: ${res.unused.join(', ')}`);
  return out.join('\n');
}
// ---------------------------------------------------------------------------

const isEnum = (t) => t.startsWith('enum');

async function columnType(table, column) {
  const [rows] = await pool.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length ? rows[0].COLUMN_TYPE : null;
}

async function survey(table, column) {
  // Table/column are hardcoded literals below -- never interpolate user input.
  const sql = table === 'tickets'
    ? 'SELECT status AS value, COUNT(*) AS count FROM tickets GROUP BY status'
    : 'SELECT action AS value, COUNT(*) AS count FROM audit_logs GROUP BY action';
  const [rows] = await pool.query(sql);
  return rows.map(r => ({ value: r.value, count: Number(r.count) }));
}

try {
  const statusType = await columnType('tickets', 'status');
  if (statusType === null) {
    console.log('\nNo `tickets` table found in this database.');
    console.log('Nothing to migrate -- just load schema.sql fresh (Step 6d).\n');
    process.exit(0);
  }

  const sRes = audit(await survey('tickets', 'status'), Object.values(STATUS));
  console.log(render('tickets.status', statusType, sRes));
  console.log(isEnum(statusType) ? '  -> already an ENUM' : '  -> still VARCHAR: the DB accepts ANY string (finding S1)');

  const actionType = await columnType('audit_logs', 'action');
  if (actionType !== null) {
    const aRes = audit(await survey('audit_logs', 'action'), Object.values(LOG_ACTION));
    console.log(render('audit_logs.action', actionType, aRes));
  }

  const blocking = sRes.illegal.length;
  console.log('\n================ VERDICT ================');
  if (blocking === 0) {
    console.log('  SAFE to run the migration.');
  } else {
    console.log(`  STOP. ${blocking} distinct illegal status value(s) exist.`);
    console.log('  MySQL will silently blank those rows to "" on ALTER.');
    console.log('  Fix them first.');
  }
  console.log('=========================================\n');
  process.exit(blocking === 0 ? 0 : 1);
} catch (err) {
  console.error(`\nInspect failed: ${err.message}`);
  if (err.code === 'ECONNREFUSED') console.error('  Is MySQL running? Check DB_* in .env.');
  if (err.code === 'ER_ACCESS_DENIED_ERROR') console.error('  Check DB_USER / DB_PASSWORD in .env.');
  process.exit(2);
} finally {
  await pool.end();
}