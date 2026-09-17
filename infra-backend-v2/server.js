import 'dotenv/config';   // MUST be first: loads .env before anything reads process.env

import app from './src/app.js';
import './src/config/db.js'; // This triggers the database connection confirmation
import './src/cron/emailReminders.js'; // This boots up the background escalation timers

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Production Server running on http://localhost:${PORT}`);
});