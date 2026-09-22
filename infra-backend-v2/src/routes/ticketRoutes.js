import express from 'express';
import pool from '../config/db.js';
import { upload } from '../middleware/upload.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';

// Import actual controllers
import {
  createTicket,
  getQueue,
  submitReport,
  updateTenderStatus,
  reviewTicket,
  publishTender,
  awardTender,
  recordBill,
  updateBillPayment,
  getAccountantOverview,
} from '../controllers/ticketController.js';

const router = express.Router();

// EVERY route below this line requires a valid token
router.use(requireAuth);

// 1.5 Applicant Dashboard (Fetch tickets created by this specific user)
router.get('/applicant', requireRole(['APPLICANT']), async (req, res) => {
  try {
    const [tickets] = await pool.query(
      `SELECT * FROM tickets WHERE applicant_id = ? ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 1. Raise a Ticket (Hooks up to the actual Auto-Assignment & Email logic)
router.post('/', requireRole(['APPLICANT', 'JE']), upload.array('files', 5), createTicket);

// 2. Role Dashboard Queue (Supports AE, SE, DEAN, DIRECTOR, CLERICAL, ACCOUNTANT, SYSADMIN)
router.get(
  '/queue',
  requireRole(['AE', 'SE', 'DEAN', 'DIRECTOR', 'CLERICAL', 'ACCOUNTANT', 'SYSADMIN']),
  getQueue
);

// 3. JE Site report + estimate (Supports dual file uploads: site_photos and estimate_docs)
router.post(
  '/:ticket_id/report',
  requireRole(['JE']),
  upload.fields([
    { name: 'site_photos', maxCount: 10 },
    { name: 'estimate_docs', maxCount: 10 },
  ]),
  submitReport
);

// 4. JE Manual Tendering Milestone Update
router.post('/:ticket_id/tender', requireRole(['JE']), updateTenderStatus);

// 4.5 Authority Hierarchical Review (AE, SE, Dean, Director)
router.post('/:ticket_id/review', requireRole(['AE', 'SE', 'DEAN', 'DIRECTOR']), reviewTicket);

// 5. JE Dashboard (Securely uses token ID, no payload spoofing)
router.get('/je/dashboard', requireRole(['JE']), async (req, res) => {
  const je_id = req.user.id;
  try {
    const [tickets] = await pool.query(
      `SELECT t.*, u.name as applicant_name, u.phone as applicant_phone, u.email as applicant_email,
              r.estimated_amount, r.nature_of_work
       FROM tickets t 
       JOIN users u ON t.applicant_id = u.id 
       LEFT JOIN (
         SELECT r1.* FROM reports r1
         JOIN (SELECT ticket_id, MAX(id) as max_id FROM reports GROUP BY ticket_id) r2
         ON r1.id = r2.max_id
       ) r ON t.id = r.ticket_id
       WHERE t.assigned_je_id = ? 
       ORDER BY t.created_at DESC`,
      [je_id]
    );
    res.json({ success: true, tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// -------------------------------------------------------------
// 6. CLERICAL TENDER ROUTES
// -------------------------------------------------------------
router.post(
  '/:ticket_id/tenders',
  requireRole(['CLERICAL', 'JE', 'SYSADMIN']),
  publishTender
);

router.post(
  '/:ticket_id/tenders/award',
  requireRole(['CLERICAL', 'JE', 'SYSADMIN']),
  awardTender
);

router.get('/:ticket_id/tenders', async (req, res) => {
  const { ticket_id } = req.params;
  try {
    const [tenders] = await pool.query(
      `SELECT tn.*, u.name as publisher_name, u.role as publisher_role 
       FROM tenders tn 
       JOIN users u ON tn.created_by = u.id 
       WHERE tn.ticket_id = ? 
       ORDER BY tn.created_at DESC`,
      [ticket_id]
    );
    res.json({ success: true, tenders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// -------------------------------------------------------------
// 7. ACCOUNTANT & FINANCE BILLING ROUTES
// -------------------------------------------------------------
router.get(
  '/accountant/overview',
  requireRole(['ACCOUNTANT', 'SYSADMIN', 'DEAN', 'DIRECTOR']),
  getAccountantOverview
);

router.get(
  '/:ticket_id/bills',
  requireRole(['ACCOUNTANT', 'SYSADMIN', 'CLERICAL', 'AE', 'SE', 'DEAN', 'DIRECTOR']),
  async (req, res) => {
    const { ticket_id } = req.params;
    try {
      const [bills] = await pool.query(
        `SELECT b.*, u.name as accountant_name 
         FROM bills b 
         JOIN users u ON b.processed_by = u.id 
         WHERE b.ticket_id = ? 
         ORDER BY b.created_at DESC`,
        [ticket_id]
      );
      res.json({ success: true, bills });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

router.post(
  '/:ticket_id/bills',
  requireRole(['ACCOUNTANT', 'SYSADMIN']),
  recordBill
);

router.patch(
  '/bills/:bill_id',
  requireRole(['ACCOUNTANT', 'SYSADMIN']),
  updateBillPayment
);

// -------------------------------------------------------------
// 8. STRICT HIERARCHICAL TICKET DETAILS (Redacted based on role)
// -------------------------------------------------------------
router.get('/:ticket_id/details', async (req, res) => {
  const { ticket_id } = req.params;
  const userRole = req.user.role;
  const userId = req.user.id;

  try {
    // 1. Fetch Ticket & Applicant Info
    const [tickets] = await pool.query(
      `SELECT t.*, u.name as applicant_name, u.email as applicant_email, u.phone as applicant_phone 
       FROM tickets t JOIN users u ON t.applicant_id = u.id WHERE t.id = ?`,
      [ticket_id]
    );
    if (tickets.length === 0) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    const ticketData = tickets[0];

    // Ownership check: If applicant, verify this ticket belongs to them
    if (userRole === 'APPLICANT' && ticketData.applicant_id !== userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to this ticket.' });
    }

    // 2. Fetch Attachments (Safe with/without document_category)
    let attachments = [];
    try {
      const [attRows] = await pool.query(
        'SELECT id, file_url, uploaded_by, created_at, document_category FROM attachments WHERE ticket_id = ? ORDER BY created_at ASC',
        [ticket_id]
      );
      attachments = attRows;
    } catch (attErr) {
      if (attErr.code === 'ER_BAD_FIELD_ERROR') {
        const [rawRows] = await pool.query(
          'SELECT id, file_url, uploaded_by, created_at FROM attachments WHERE ticket_id = ? ORDER BY created_at ASC',
          [ticket_id]
        );
        attachments = rawRows.map(r => ({ ...r, document_category: 'APPLICANT_EVIDENCE' }));
      } else {
        throw attErr;
      }
    }

    // 3. Fetch JE Reports
    const [reports] = await pool.query(
      'SELECT * FROM reports WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1',
      [ticket_id]
    );

    // 4. Fetch Tenders
    let tenders = [];
    try {
      const [tRows] = await pool.query('SELECT * FROM tenders WHERE ticket_id = ? ORDER BY created_at DESC', [ticket_id]);
      tenders = tRows;
    } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE') tenders = [];
      else throw err;
    }

    // 5. Fetch Bills
    let bills = [];
    try {
      const [bRows] = await pool.query('SELECT * FROM bills WHERE ticket_id = ? ORDER BY created_at DESC', [ticket_id]);
      bills = bRows;
    } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE') bills = [];
      else throw err;
    }

    // 6. Fetch Audit Logs
    const [auditLogs] = await pool.query(
      `SELECT a.action, a.remarks, a.created_at, u.name as actor_name, u.role as actor_role 
       FROM audit_logs a JOIN users u ON a.user_id = u.id 
       WHERE a.ticket_id = ? ORDER BY a.created_at ASC`,
      [ticket_id]
    );

    // =========================================================
    // STRICT HIERARCHICAL REDACTION RULES
    // =========================================================
    if (userRole === 'APPLICANT') {
      // APPLICANT: Can only see the issue status and their evidence photos.
      // Strictly redact internal estimates, notes, authority remarks, tenders, and bills.
      ticketData.attachments = attachments.filter(
        (a) => a.document_category === 'APPLICANT_EVIDENCE' || a.document_category === 'JE_SITE_PHOTO'
      );
      ticketData.report = null;
      ticketData.audit_logs = [];
      ticketData.tenders = [];
      ticketData.bills = [];
    } else if (userRole === 'JE') {
      // JE: Can see applicant request, their own reports, site photos, estimate docs.
      // Internal remarks of higher authority desks are redacted.
      ticketData.attachments = attachments;
      ticketData.report = reports.length > 0 ? reports[0] : null;
      ticketData.tenders = tenders;
      ticketData.bills = bills;
      ticketData.audit_logs = auditLogs.map((log) => ({
        action: log.action,
        created_at: log.created_at,
        actor_role: log.actor_role,
        remarks: log.actor_role === 'JE' || log.action === 'SUBMITTED' || log.action === 'CREATED' || log.action === 'ASSIGNED'
          ? log.remarks
          : '[Internal Authority Decision Recorded]',
      }));
    } else if (userRole === 'CLERICAL') {
      // CLERICAL: Sees work scope, estimate, tender records, and audit events.
      ticketData.attachments = attachments;
      ticketData.report = reports.length > 0 ? reports[0] : null;
      ticketData.tenders = tenders;
      ticketData.bills = bills;
      ticketData.audit_logs = auditLogs;
    } else if (userRole === 'ACCOUNTANT') {
      // ACCOUNTANT: Sees work scope, estimates, awarded contracts, bill ledger, and audit events.
      ticketData.attachments = attachments;
      ticketData.report = reports.length > 0 ? reports[0] : null;
      ticketData.tenders = tenders;
      ticketData.bills = bills;
      ticketData.audit_logs = auditLogs;
    } else {
      // AUTHORITY ROLES (AE, SE, DEAN, DIRECTOR, SYSADMIN): Full unredacted visibility
      ticketData.attachments = attachments;
      ticketData.report = reports.length > 0 ? reports[0] : null;
      ticketData.tenders = tenders;
      ticketData.bills = bills;
      ticketData.audit_logs = auditLogs;
    }

    res.json({ success: true, ticket: ticketData });
  } catch (error) {
    console.error('getTicketDetails error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;