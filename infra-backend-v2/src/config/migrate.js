import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { openConnection } from './dbOptions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = path.join(__dirname, '../../migrations');

// Each set is a directory under migrations/ plus its own tracking table. The
// core set (shared identity) runs before the module set. A module creates,
// alters and drops only objects with its own prefix.
export const MIGRATION_SETS = [
  { dir: 'mnt', table: 'mnt_schema_migrations' },
];

const LOCK_NAME_SQL = "CONCAT(DATABASE(), ':migrate')";

// Own connection, not the shared pool: needs `multipleStatements` on to run
// a whole .sql file (several ; separated statements) in one query, which the
// app pool deliberately does not enable (multi-statement queries are an SQL
// injection amplifier on a request-scoped connection).
function openMigrationConnection() {
  return openConnection(mysql, { multipleStatements: true });
}

async function takeLock(connection) {
  const [[row]] = await connection.query(`SELECT GET_LOCK(${LOCK_NAME_SQL}, 60) AS got`);
  if (row.got !== 1) throw new Error('Migrations: could not get the migration lock within 60 s (another instance is migrating).');
}

async function releaseLock(connection) {
  try { await connection.query(`SELECT RELEASE_LOCK(${LOCK_NAME_SQL})`); } catch { /* connection ends anyway */ }
}

// A database of this module from before the prefix rename has an unprefixed
// schema_migrations table listing the old first migration. Creating new tables
// beside it would hide the mistake. Other unprefixed tables are left alone: they
// can belong to another module.
async function refuseLegacyDatabase(connection) {
  const [[hasFilename]] = await connection.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations' AND COLUMN_NAME = 'filename'`);
  if (!hasFilename.n) return;
  const [rows] = await connection.query(
    "SELECT 1 FROM schema_migrations WHERE filename = '001_status_and_action_enum.sql' LIMIT 1");
  if (rows.length) {
    throw new Error(
      'Migrations: this database holds the module from before the prefix rename (unprefixed schema_migrations). ' +
      'Refusing to create prefixed tables beside it. Check DB_NAME and DB_HOST.');
  }
}

async function ensureMigrationsTable(connection, table) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ${table} (
      id INT AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

// Runs every .sql file of each set, in filename order, that is not yet recorded
// in the set's tracking table. Each file is applied and recorded on the same
// connection so a crash mid-file does not mark it as done, but MySQL's implicit
// commit on DDL means a file that fails partway through must be safe to re-run.
// Every file is written that way (CREATE TABLE IF NOT EXISTS, INSERT IGNORE).
export async function runMigrations(sets = MIGRATION_SETS) {
  const connection = await openMigrationConnection();
  try {
    await takeLock(connection);
    await refuseLegacyDatabase(connection);

    for (const { dir, table } of sets) {
      await ensureMigrationsTable(connection, table);

      const [appliedRows] = await connection.query(`SELECT filename FROM ${table}`);
      const applied = new Set(appliedRows.map((row) => row.filename));

      const files = fs
        .readdirSync(path.join(MIGRATIONS_ROOT, dir))
        .filter((f) => f.endsWith('.sql'))
        .sort();

      for (const file of files) {
        if (applied.has(file)) continue;

        const sql = fs.readFileSync(path.join(MIGRATIONS_ROOT, dir, file), 'utf8');
        console.log(`Migrations: applying ${dir}/${file}...`);
        await connection.query(sql);
        await connection.query(`INSERT INTO ${table} (filename) VALUES (?)`, [file]);
        console.log(`Migrations: applied ${dir}/${file}`);
      }

      if (files.every((f) => applied.has(f))) {
        console.log(`Migrations: ${dir} already up to date.`);
      }
    }
  } finally {
    await releaseLock(connection);
    await connection.end();
  }
}
