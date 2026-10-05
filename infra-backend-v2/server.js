import 'dotenv/config';   // MUST be first: loads .env before anything reads process.env

import app from './src/app.js';
import pool from './src/config/db.js'; // This triggers the database connection confirmation
import { runMigrations } from './src/config/migrate.js';
import { logDeskHealth } from './src/services/deskHealth.js';
import { reconcileDeskOwners } from './src/models/deskModel.js';
import { syncDemoAccounts } from './src/config/demo.js';
import { startEmailWorker } from './src/cron/emailReminders.js';
import { sweepTempUploads } from './src/utils/fileManager.js';
import { purgeTrash } from './src/services/ticketDeletion.js';
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

  // Demo accounts follow DEMO_LDAP_ENABLED. Never fatal: a failure only leaves demo login unavailable.
  await syncDemoAccounts(pool);

  try {
    await logDeskHealth(pool);
  } catch (err) {
    logger.error('desk health check failed', errorFields(err));
  }

  app.listen(PORT, () => {
    logger.info('server listening', { port: PORT });
    startEmailWorker(); // outbox + reminder worker (every minute)

    // Files left in uploads/temp by a crashed request: sweep at boot, then daily.
    const sweep = () => sweepTempUploads()
      .then((n) => n && logger.info('swept temp uploads', { removed: n }))
      .catch((err) => logger.error('temp sweep failed', errorFields(err)));
    sweep();
    setInterval(sweep, 24 * 60 * 60 * 1000).unref();

    // Deleted tickets' files wait 30 days in uploads/trash, then go.
    const purge = () => {
      try {
        const n = purgeTrash();
        if (n) logger.info('purged ticket trash', { folders: n });
      } catch (err) {
        logger.error('trash purge failed', errorFields(err));
      }
    };
    purge();
    setInterval(purge, 24 * 60 * 60 * 1000).unref();
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
