import express from 'express';
import pool from '../config/db.js';
import { upload } from '../middleware/upload.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';

// Import your actual controllers!
import { createTicket, getQueue, updateTenderStatus } from '../controllers/ticketController.js';

const router = express.Router();

// EVERY route below this line requires a valid Firebase token
router.use(requireAuth);

// 1. Raise a Ticket (Hooks up to the actual Auto-Assignment & Email logic)
router.post('/', requireRole(['APPLICANT', 'JE']), upload.array('files', 5), createTicket);

// 2. Authority Dashboard Queue (Pagination enabled)
router.get('/queue', requireRole(['AE', 'SE', 'DEAN', 'DIRECTOR']), getQueue);

// 3. JE Manual Tendering Milestone Update
router.post('/:ticket_id/tender', requireRole(['JE']), updateTenderStatus);

// 4. JE Dashboard (Securely uses token ID, no payload spoofing)
router.get('/je/dashboard', requireRole(['JE']), async (req, res) => {
  const je_id = req.user.id;
  try {
    const [tickets] = await pool.query(
      `SELECT t.*, u.name as applicant_name, u.phone as applicant_phone 
       FROM tickets t JOIN users u ON t.applicant_id = u.id 
       WHERE t.assigned_je_id = ? ORDER BY t.created_at DESC`,
      [je_id]
    );
    res.json({ success: true, tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 5. Get Full Ticket Details (Enforces visibility rules)
router.get('/:ticket_id/details', async (req, res) => {
  const { ticket_id } = req.params;
  const userRole = req.user.role;

  try {
    const [tickets] = await pool.query(
      `SELECT t.*, u.name as applicant_name FROM tickets t 
       JOIN users u ON t.applicant_id = u.id WHERE t.id = ?`, [ticket_id]
    );
    if (tickets.length === 0) return res.status(404).json({ success: false, message: 'Ticket not found' });
    
    const ticketData = tickets[0];

    // Fetch Audit Logs (ONLY if authority role)[cite: 2]
    const authorityRoles = ['AE', 'SE', 'DEAN', 'DIRECTOR', 'SYSADMIN'];
    if (authorityRoles.includes(userRole)) {
      const [logs] = await pool.query(
        `SELECT a.action, a.remarks, a.created_at, u.name as actor_name, u.role as actor_role 
         FROM audit_logs a JOIN users u ON a.user_id = u.id 
         WHERE a.ticket_id = ? ORDER BY a.created_at ASC`, [ticket_id]
      );
      ticketData.audit_logs = logs;
    } else {
      ticketData.audit_logs = []; // JE cannot see internal remarks[cite: 5]
    }

    res.json({ success: true, ticket: ticketData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;