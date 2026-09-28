import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');

// Own connection, not the shared pool: needs `multipleStatements` on to run
// a whole .sql file (several ; separated statements) in one query, which the
// app pool deliberately does not enable (multi-statement queries are an SQL
// injection amplifier on a request-scoped connection).
async function openMigrationConnection() {
  return mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'deanery_infra',
    multipleStatements: true,
  });
}

async function ensureMigrationsTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

// Runs every migrations/*.sql file, in filename order, that is not yet
// recorded in schema_migrations. Each file is applied and recorded in the
// same connection so a crash mid-file does not mark it as done, but MySQL's
// implicit commit on DDL means a file that fails partway through must be
// safe to re-run — every file in migrations/ is written that way (see the
// header comment in 001_status_and_action_enum.sql).
export async function runMigrations() {
  const connection = await openMigrationConnection();
  try {
    await ensureMigrationsTable(connection);

    const [appliedRows] = await connection.query('SELECT filename FROM schema_migrations');
    const applied = new Set(appliedRows.map((row) => row.filename));

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`Migrations: applying ${file}...`);
      await connection.query(sql);
      await connection.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
      console.log(`Migrations: applied ${file}`);
    }

    if (files.every((f) => applied.has(f))) {
      console.log('Migrations: schema already up to date.');
    }
  } finally {
    await connection.end();
  }
}
