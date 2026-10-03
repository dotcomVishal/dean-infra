import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { dbConfig, SESSION_INIT_SQL } from './dbConfig.js';
import { lintMigration } from './migrationLint.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');
const TRACKING_TABLE = 'infra_schema_migrations';
const LOCK_NAME = 'infra_migrate';

// The database can be on another machine that is briefly unreachable at boot.
async function connectWithRetry(options, seconds = 60) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    try {
      return await mysql.createConnection(options);
    } catch (err) {
      if (Date.now() >= deadline) throw err;
      console.log(`Migrations: database not reachable (${err.code ?? err.message}), retrying...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// Own connection, not the shared pool: needs `multipleStatements` on to run
// a whole .sql file in one query, which the app pool deliberately does not
// enable (multi-statement queries are an SQL injection amplifier).
async function openMigrationConnection(overrides) {
  const connection = await connectWithRetry(dbConfig({ multipleStatements: true, ...overrides }));
  await connection.query(SESSION_INIT_SQL);
  return connection;
}

async function trackingTableExists(connection) {
  const [rows] = await connection.query(
    'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [TRACKING_TABLE]);
  return rows.length > 0;
}

/**
 * Applies every migrations/*.sql file, in filename order, that is not yet
 * recorded in infra_schema_migrations. One runner at a time (GET_LOCK).
 * @param {{database?: string, expectExisting?: boolean}} [options]
 *   expectExisting: refuse to start against a database that has no tracking
 *   table (a wrong DB_NAME or a wiped schema must not become an empty install).
 */
export async function runMigrations(options = {}) {
  const expectExisting = options.expectExisting ?? process.env.INFRA_EXPECT_EXISTING_DB === 'true';
  const connection = await openMigrationConnection(options.database ? { database: options.database } : {});
  let locked = false;
  try {
    const [[lock]] = await connection.query('SELECT GET_LOCK(?, 60) AS got', [LOCK_NAME]);
    if (lock.got !== 1) throw new Error('Migrations: could not get the migration lock within 60 seconds.');
    locked = true;

    if (!(await trackingTableExists(connection))) {
      if (expectExisting) {
        throw new Error(
          `Migrations: ${TRACKING_TABLE} not found but INFRA_EXPECT_EXISTING_DB=true. `
          + 'Refusing to create an empty install. Check DB_NAME.');
      }
      await connection.query(`
        CREATE TABLE ${TRACKING_TABLE} (
          id INT AUTO_INCREMENT PRIMARY KEY,
          filename VARCHAR(255) NOT NULL UNIQUE,
          applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }

    const [appliedRows] = await connection.query(`SELECT filename FROM ${TRACKING_TABLE}`);
    const applied = new Set(appliedRows.map((row) => row.filename));

    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    const pending = files.filter((f) => !applied.has(f));

    // Lint every pending file before running any of them.
    const sqlByFile = new Map();
    for (const file of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const lint = lintMigration(sql);
      if (!lint.ok) {
        throw new Error(
          `Migrations: ${file} contains ${lint.found.join(', ')} and has no "-- destructive-ok: <reason>" marker. Refusing to run.`);
      }
      sqlByFile.set(file, sql);
    }

    for (const file of pending) {
      console.log(`Migrations: applying ${file}...`);
      await connection.query(sqlByFile.get(file));
      await connection.query(`INSERT INTO ${TRACKING_TABLE} (filename) VALUES (?)`, [file]);
      console.log(`Migrations: applied ${file}`);
    }

    if (pending.length === 0) console.log('Migrations: schema already up to date.');
  } finally {
    if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]).catch(() => {});
    await connection.end();
  }
}
