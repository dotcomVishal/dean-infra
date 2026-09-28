// Manual migration runner: `node scripts/migrate.mjs`.
// Same code path server.js runs on every boot (src/config/migrate.js) — this
// wrapper exists so a fresh or upgraded database can be brought up to date
// without starting the whole server.
import 'dotenv/config';
import { runMigrations } from '../src/config/migrate.js';

runMigrations()
  .then(() => {
    console.log('Migrations: done.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migrations: failed.', err);
    process.exit(1);
  });
