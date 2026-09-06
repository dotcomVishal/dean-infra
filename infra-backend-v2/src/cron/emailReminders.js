import cron from 'node-cron';
import pool from '../config/db.js';
import { sendEmail } from '../utils/mailer.js';

// Runs every hour on the hour
cron.schedule('0 * * * *', async () => {
  try {
    // Fetch tickets assigned to JEs that haven't been actioned yet
    const [tickets] = await pool.query(`
      SELECT t.id, t.created_at, u.email, u.name 
      FROM tickets t
      JOIN users u ON t.assigned_je_id = u.id
      WHERE t.status = 'ASSIGNED_TO_JE'
    `);

    const now = new Date();

    for (const ticket of tickets) {
      const hoursPending = Math.floor((now - new Date(ticket.created_at)) / (1000 * 60 * 60));

      // Check against your specific milestone windows[cite: 3]
      if (hoursPending === 12 || hoursPending === 24 || (hoursPending > 24 && hoursPending % 72 === 0)) {
        await sendEmail(
          ticket.email,
          `URGENT: Ticket #${ticket.id} requires inspection`,
          `Dear ${ticket.name}, Ticket #${ticket.id} has been pending for ${hoursPending} hours. Please submit your inspection report on the portal.`
        );
      }
    }
  } catch (error) {
    console.error('Cron Job Error:', error);
  }
});