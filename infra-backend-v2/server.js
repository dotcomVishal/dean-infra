import 'dotenv/config';   // MUST be first: loads .env before anything reads process.env

import app from './src/app.js';
import pool from './src/config/db.js'; // This triggers the database connection confirmation
import { runMigrations } from './src/config/migrate.js';
import './src/cron/emailReminders.js'; // This boots up the background escalation timers

const PORT = process.env.PORT || 5000;

// Run migrations/*.sql (schema_migrations tracks what's applied), then start
// accepting requests. Schema is owned by migrations only (D1, D2) — nothing
// here patches the schema at request time.
(async () => {
  try {
    await runMigrations();
  } catch (err) {
    console.error('Migration startup failed:', err.message);
    process.exit(1);
  }
  
  app.listen(PORT, () => {
    console.log(`🚀 Production Server running on http://localhost:${PORT}`);
  });
})();