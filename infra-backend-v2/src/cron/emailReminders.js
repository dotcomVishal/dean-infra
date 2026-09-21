import cron from 'node-cron';
import pool from '../config/db.js';
import { sendEmail } from '../utils/mailer.js';

// Runs every hour on the hour
cron.schedule('0 * * * *', async () => {
  try {
    // Fetch tickets assigned to JEs that haven't been actioned yet
    const [tickets] = await pool.query(`
      SELECT t.id, t.title, t.department, t.location, t.description, t.created_at, u.email, u.name 
      FROM tickets t
      JOIN users u ON t.assigned_je_id = u.id
      WHERE t.status = 'ASSIGNED_TO_JE'
    `);

    const now = new Date();
    const portalUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    for (const ticket of tickets) {
      const hoursPending = Math.floor((now - new Date(ticket.created_at)) / (1000 * 60 * 60));

      // Escalation milestones: 12h, 24h, and every 72h thereafter
      if (hoursPending === 12 || hoursPending === 24 || (hoursPending > 24 && hoursPending % 72 === 0)) {
        const ticketTitle = ticket.title || `Ticket #${ticket.id}`;
        await sendEmail(
          ticket.email,
          `[ACTION REQUIRED] Pending Inspection for #${ticket.id}: ${ticketTitle}`,
          `Dear ${ticket.name},

This is an automated operational reminder from the Deanery of Infrastructure.

Ticket #${ticket.id} (${ticketTitle}) has been pending your site inspection for ${hoursPending} hours.

• Department: ${ticket.department}
• Location:   ${ticket.location || 'Campus Landmark'}
• Details:    ${ticket.description?.substring(0, 150)}...

Please submit your site inspection findings and estimated amount as soon as possible to avoid administrative escalation:
${portalUrl}/je/ticket/${ticket.id}

Deanery of Infrastructure, IIT Mandi`
        );
      }
    }
  } catch (error) {
    console.error('Cron Job Error:', error);
  }
});