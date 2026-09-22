import 'dotenv/config';   // MUST be first: loads .env before anything reads process.env

import app from './src/app.js';
import pool from './src/config/db.js'; // This triggers the database connection confirmation
import { runAutoMigrations } from './src/config/autoMigrate.js';
import './src/cron/emailReminders.js'; // This boots up the background escalation timers

const PORT = process.env.PORT || 5000;

// Execute auto-migrations, then start accepting requests
(async () => {
  try {
    await runAutoMigrations();
  } catch (err) {
    console.error('Migration startup warning:', err.message);
  }
  
  app.listen(PORT, () => {
    console.log(`🚀 Production Server running on http://localhost:${PORT}`);
  });
})();