import 'dotenv/config';   // MUST be first: loads .env before anything reads process.env

import app from './src/app.js';
import pool from './src/config/db.js'; // This triggers the database connection confirmation
import { runMigrations } from './src/config/migrate.js';
import { logDeskHealth } from './src/services/deskHealth.js';
import { reconcileDeskOwners } from './src/models/deskModel.js';
import { startEmailWorker } from './src/cron/emailReminders.js';
import logger, { errorFields } from './src/utils/logger.js';

const PORT = process.env.PORT || 5000;

// Run migrations/*.sql (schema_migrations tracks what's applied), then start
// accepting requests. Schema is owned by migrations only (D1, D2) — nothing
// here patches the schema at request time.
(async () => {
  try {
    await runMigrations();
    const fixed = await reconcileDeskOwners(pool); // A3: heal stale desk owners
    if (fixed) logger.info('reconciled stale desk owners', { fixed });
  } catch (err) {
    logger.error('migration startup failed', errorFields(err));
    process.exit(1);
  }

  try {
    await logDeskHealth(pool);
  } catch (err) {
    logger.error('desk health check failed', errorFields(err));
  }

  app.listen(PORT, () => {
    logger.info('server listening', { port: PORT });
    startEmailWorker(); // outbox + reminder worker (every minute)
  });
})();

// S12: last-resort nets. Log with full detail; a truly uncaught exception exits so the container restarts.
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', errorFields(reason));
});
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', errorFields(err));
  process.exit(1);
});
