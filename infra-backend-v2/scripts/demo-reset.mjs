// Manual tool: delete every demo ticket (and, with --purge-users, the demo accounts). Never run automatically.
// Usage:  npm run demo:reset              (dry run: lists what would go)
//         npm run demo:reset -- --yes     (deletes)
//         npm run demo:reset -- --yes --purge-users
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { openConnection } from '../src/config/dbOptions.js';
import { TICKETS_DIR } from '../src/config/paths.js';
import { deleteTicketCascade } from '../src/services/ticketDeletion.js';

const yes = process.argv.includes('--yes');
const purgeUsers = process.argv.includes('--purge-users');

const conn = await openConnection(mysql);

try {
  const [tickets] = await conn.query('SELECT id, title, status FROM mnt_tickets WHERE is_demo = TRUE ORDER BY id');
  console.log(`${tickets.length} demo ticket(s)${purgeUsers ? ' and the demo accounts' : ''} ${yes ? 'will be deleted' : 'would be deleted (dry run, add --yes)'}.`);
  for (const t of tickets) console.log(`  #${t.id} ${t.status} ${t.title ?? ''}`);
  if (!yes) process.exit(0);

  for (const t of tickets) {
    await conn.beginTransaction();
    try {
      // Refuse anything that is not a demo ticket, even if the list above said so.
      const [[row]] = await conn.query('SELECT is_demo FROM mnt_tickets WHERE id = ? FOR UPDATE', [t.id]);
      if (!row?.is_demo) throw new Error(`ticket ${t.id} is not a demo ticket`);
      await deleteTicketCascade(conn, t.id);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    }
    fs.rmSync(path.join(TICKETS_DIR, String(t.id)), { recursive: true, force: true });
  }
  console.log('Demo tickets deleted.');

  if (purgeUsers) {
    const [r] = await conn.query('DELETE FROM mnt_users WHERE is_demo = TRUE');
    console.log(`Demo accounts deleted: ${r.affectedRows}.`);
  }
} finally {
  await conn.end();
}
