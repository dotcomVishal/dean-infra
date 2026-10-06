// O2: bring an EMPTY MySQL up to the current schema for CI / local integration tests.
// Runs the same migration runner the deploy step uses. Idempotent. Never point it
// at a database you care about: it is for the throwaway service container
// (docker-compose.test.yml locally, `services: mysql` in CI). It refuses any
// database whose name does not end in `_ci`.
import '../test/integration/guard.mjs';
import mysql from 'mysql2/promise';
import { buildConnectionOptions } from '../src/config/dbOptions.js';
import { runMigrations } from '../src/config/migrate.js';

// The MySQL container needs a few seconds after "started"; retry instead of failing the job.
async function waitForDatabase(tries = 30) {
  for (let i = 1; ; i++) {
    try {
      const conn = await mysql.createConnection(buildConnectionOptions());
      await conn.end();
      return;
    } catch (err) {
      if (i >= tries) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

await waitForDatabase();
await runMigrations();
console.log('prepare-test-db: schema ready.');
