// First-run tool: make one real person the Sysadmin of this module.
//
//   node scripts/bootstrap-sysadmin.mjs --email someone@iitmandi.ac.in --name "Full Name"
//
// A clean database has no staff and no Sysadmin, and the seed scripts invent addresses nobody can
// sign in with. This creates the core_users row when missing (placeholder firebase_uid, replaced on
// the first Google sign-in by the existing link-by-e-mail logic) and sets mnt_members.role = SYSADMIN.
// Safe to run twice. Refuses an address ending in .invalid.
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import pool from '../src/config/db.js';

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
};

export async function bootstrapSysadmin(db, { email, name }) {
  const cleanEmail = String(email ?? '').trim().toLowerCase();
  const cleanName = String(name ?? '').trim();
  if (!cleanEmail || !cleanName) throw new Error('both --email and --name are required');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) throw new Error(`not an e-mail address: ${cleanEmail}`);
  if (cleanEmail.endsWith('.invalid')) throw new Error('refusing an address ending in .invalid: nobody can sign in with it');

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT IGNORE INTO core_users (firebase_uid, name, email, is_active) VALUES (?, ?, ?, TRUE)`,
      [`bootstrap_${cleanEmail}`.slice(0, 128), cleanName, cleanEmail]);
    const [[user]] = await connection.query('SELECT id FROM core_users WHERE email = ?', [cleanEmail]);
    await connection.query(
      `INSERT INTO mnt_members (user_id, role, department, is_active) VALUES (?, 'SYSADMIN', 'Administration', TRUE)
       ON DUPLICATE KEY UPDATE role = 'SYSADMIN', department = 'Administration', is_active = TRUE`,
      [user.id]);
    await connection.commit();
    return user.id;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

// Run as a script, not when imported by a test.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const id = await bootstrapSysadmin(pool, { email: arg('--email'), name: arg('--name') });
    console.log(`Sysadmin ready: user #${id}. They can now sign in with Google.`);
  } catch (err) {
    console.error(`bootstrap-sysadmin: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
