// Dev/test only: loads scripts/seed-mock-users.sql (D7). Idempotent guard: skips if users exist.
import 'dotenv/config';
if (process.env.NODE_ENV === 'production') { console.error('seed-mock-users: refusing to run with NODE_ENV=production (invented addresses nobody can sign in with).'); process.exit(1); }
import fs from 'node:fs';
import mysql from 'mysql2/promise';
import { openConnection } from '../src/config/dbOptions.js';

const conn = await openConnection(mysql, { multipleStatements: true });
const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM core_users');
if (n > 0) console.log(`users table has ${n} rows; skipping mock users.`);
else { await conn.query(fs.readFileSync(new URL('./seed-mock-users.sql', import.meta.url), 'utf8')); console.log('Mock users loaded.'); }
await conn.end();
