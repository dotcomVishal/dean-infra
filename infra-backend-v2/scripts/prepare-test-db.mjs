// O2: bring an EMPTY MySQL up to the current schema for CI / local integration tests.
//   schema.sql (baseline, what docker-compose loads on first boot)
//   + migrations/*.sql (the same runner server.js uses on boot)
// Idempotent. Never point it at a database you care about: it is for the throwaway
// service container (docker-compose.test.yml locally, `services: mysql` in CI).
//
// Uses DB_HOST / DB_PORT / DB_USER / DB_PASSWORD. The database name is fixed to
// `deanery_infra` because schema.sql and the migrations `USE` it explicitly.
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { runMigrations } from '../src/config/migrate.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
};

if (process.env.DB_NAME && process.env.DB_NAME !== 'deanery_infra') {
  console.error(`prepare-test-db: DB_NAME must be deanery_infra (schema.sql and migrations hardcode it), got ${process.env.DB_NAME}`);
  process.exit(1);
}

// The MySQL container needs a few seconds after "started"; retry instead of failing the job.
async function connectWithRetry(tries = 30) {
  for (let i = 1; ; i++) {
    try {
      return await mysql.createConnection({ ...cfg, multipleStatements: true });
    } catch (err) {
      if (i >= tries) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

const conn = await connectWithRetry();
try {
  // schema.sql also INSERTs seed users, so it is not re-runnable: load it once only.
  const [[{ n }]] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = 'deanery_infra' AND TABLE_NAME = 'users'`);
  if (n === 0) await conn.query(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'));
} finally {
  await conn.end();
}
await runMigrations();
console.log('prepare-test-db: schema ready.');
