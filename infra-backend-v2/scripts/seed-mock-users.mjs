// Dev/test only: loads scripts/seed-mock-users.sql (D7). Idempotent guard: skips if users exist.
import 'dotenv/config';
import fs from 'node:fs';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'deanery_infra', multipleStatements: true,
});
const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM users');
if (n > 0) console.log(`users table has ${n} rows; skipping mock users.`);
else { await conn.query(fs.readFileSync(new URL('./seed-mock-users.sql', import.meta.url), 'utf8')); console.log('Mock users loaded.'); }
await conn.end();
