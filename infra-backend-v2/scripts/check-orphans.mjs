// Read-only: counts rows whose ticket no longer exists, in each child table.
// Run before and after the Phase 7 go-live; every number should be 0.
//   node scripts/check-orphans.mjs
import 'dotenv/config';
import pool from '../src/config/db.js';
import { CHILD_TABLES } from '../src/services/ticketDeletion.js';

let bad = 0;
for (const table of CHILD_TABLES) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS n FROM mnt_${table} c LEFT JOIN mnt_tickets t ON t.id = c.ticket_id WHERE c.ticket_id IS NOT NULL AND t.id IS NULL`);
  console.log(`${table.padEnd(16)} ${row.n}`);
  bad += Number(row.n);
}
console.log(bad === 0 ? 'No orphans.' : `${bad} orphan row(s).`);
await pool.end();
process.exit(bad === 0 ? 0 : 1);
