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
  publishTender,
  awardTender,
  recordBill,
  updateBillPayment,
  getAccountantOverview,
} from '../controllers/ticketController.js';
import { performTicketAction } from '../controllers/actionController.js';
import { getDeskBoard, getAssignableJes } from '../controllers/deskController.js';
import { availableActions, approvalLimitFor } from '../config/workflow.js';
import { findDeskOwner } from '../models/deskModel.js';
import { loadActionContext } from '../services/actionContext.js';
import { listForTicket } from '../models/messageModel.js';
import {
  loadViewer, canViewTicket, staffRole, capabilities, applicantTicket, buildTicketDetails,
} from '../services/visibility.js';
import { sendServerError } from '../utils/httpError.js';

const router = express.Router();

// EVERY route below this line requires a valid token
router.use(requireAuth);

// 1.5 Applicant Dashboard (Fetch tickets created by this specific user)
// W15: "My tickets" is open to every authenticated, active role -- being the
// applicant is a relation (tickets.applicant_id), not a role restriction.
router.get('/applicant', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM tickets WHERE applicant_id = ? ORDER BY created_at DESC`,
      [req.user.id]
    );
    // Applicant view: no assignee / desk-owner ids, stage in plain words (Q11).
    res.json({ success: true, tickets: rows.map(applicantTicket) });
  } catch (error) {
    return sendServerError(req, res, error, 'ticketRoutes:46');
  }
});

// 1.6 Role dashboards: My desk / Watching / My tickets (Phase 7). Registered
// before any '/:ticket_id' route so 'desk' is never read as an id.
router.get('/desk', getDeskBoard);

// 1. Raise a Ticket (Hooks up to the actual Auto-Assignment & Email logic)
// W15: any active, authenticated user may raise a ticket -- students, faculty,
// staff and every internal role (AE/SE/Clerical/Accountant/Dean/Director), not
// just APPLICANT/JE/SYSADMIN.
router.post('/', upload.array('files', 5), createTicket);

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

// 4.5 Desk actions (replaces /review): FORWARD, APPROVE, REQUEST_CHANGES,
// REJECT, ASSIGN_JE. The route only gates the role; the state machine decides
// whether THIS person may do THIS action on THIS ticket right now.
router.post('/:ticket_id/actions', requireRole(['AE', 'SE', 'DEAN', 'DIRECTOR']), performTicketAction);

// 4.6 JE picker for the AE's ASSIGN_JE action on an UNASSIGNED ticket.
router.get('/:ticket_id/assignable-jes', requireRole(['AE']), getAssignableJes);

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
    return sendServerError(req, res, error, 'ticketRoutes:109');
  }
});

// -------------------------------------------------------------
// 6. CLERICAL TENDER ROUTES
// -------------------------------------------------------------
// S1: tendering/award belong to Clerical only. A JE (any JE, not just the
// assigned one) used to be able to call these directly and skip the whole
// approval chain -- the status guard in the controller closes that, but the
// route no longer even offers JE the button.
router.post(
  '/:ticket_id/tenders',
  requireRole(['CLERICAL', 'SYSADMIN']),
  publishTender
);

router.post(
  '/:ticket_id/tenders/award',
  requireRole(['CLERICAL', 'SYSADMIN']),
  awardTender
);

// S6: previously unauthenticated-in-effect -- no role or scope check meant an
// APPLICANT could read tender data for any ticket id.
router.get(
  '/:ticket_id/tenders',
  requireRole(['JE', 'AE', 'SE', 'DEAN', 'DIRECTOR', 'CLERICAL', 'ACCOUNTANT', 'SYSADMIN']),
  async (req, res) => {
    const { ticket_id } = req.params;
    try {
      const [ticketRows] = await pool.query(
        `SELECT id, applicant_id, department, campus, status, assigned_je_id, current_desk_user_id
           FROM tickets WHERE id = ?`,
        [ticket_id]
      );
      if (ticketRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Ticket not found' });
      }
      const viewer = await loadViewer(pool, req.user, ticketRows[0]);
      if (!capabilities(viewer, ticketRows[0]).tenders) {
        return res.status(403).json({ success: false, message: 'Unauthorized access to this ticket.' });
      }

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
      return sendServerError(req, res, error, 'getTenders error');
    }
  }
);

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
      const [ticketRows] = await pool.query(
        `SELECT id, applicant_id, department, campus, status, assigned_je_id, current_desk_user_id
           FROM tickets WHERE id = ?`,
        [ticket_id]
      );
      if (ticketRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Ticket not found' });
      }
      const viewer = await loadViewer(pool, req.user, ticketRows[0]);
      if (!capabilities(viewer, ticketRows[0]).bills) {
        return res.status(403).json({ success: false, message: 'Unauthorized access to this ticket.' });
      }
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
      return sendServerError(req, res, error, 'ticketRoutes:206');
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
// 8. TICKET DETAILS -- every redaction decision lives in services/visibility.js
// -------------------------------------------------------------
router.get('/:ticket_id/details', async (req, res) => {
  const { ticket_id } = req.params;
  const userRole = req.user.role;
  const userId = req.user.id;

  try {
    const [tickets] = await pool.query(
      `SELECT t.*, u.name as applicant_name, u.email as applicant_email, u.phone as applicant_phone
       FROM tickets t JOIN users u ON t.applicant_id = u.id WHERE t.id = ?`,
      [ticket_id]
    );
    if (tickets.length === 0) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    const ticketRow = tickets[0];

    // S5: one scope rule for every role (visibility matrix, plan.md §3.6).
    const viewer = await loadViewer(pool, req.user, ticketRow);
    if (!canViewTicket(viewer, ticketRow)) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to this ticket.' });
    }

    const [attachments] = await pool.query(
      `SELECT a.id, a.file_url, a.uploaded_by, a.created_at, a.document_category, a.report_id,
              u.role AS uploader_role
         FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
        WHERE a.ticket_id = ? ORDER BY a.created_at ASC, a.id ASC`,
      [ticket_id]
    );
    const [reports] = await pool.query(
      'SELECT * FROM reports WHERE ticket_id = ? ORDER BY version DESC LIMIT 1', [ticket_id]);

    let tenders = [];
    try {
      [tenders] = await pool.query('SELECT * FROM tenders WHERE ticket_id = ? ORDER BY created_at DESC', [ticket_id]);
    } catch (err) {
      if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
    }
    let bills = [];
    try {
      [bills] = await pool.query('SELECT * FROM bills WHERE ticket_id = ? ORDER BY created_at DESC', [ticket_id]);
    } catch (err) {
      if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
    }

    const [auditLogs] = await pool.query(
      `SELECT a.action, a.remarks, a.created_at, a.user_id, a.visibility, a.from_desk, a.to_desk,
              u.name as actor_name, u.role as actor_role
         FROM audit_logs a JOIN users u ON a.user_id = u.id
        WHERE a.ticket_id = ? ORDER BY a.created_at ASC, a.id ASC`,
      [ticket_id]
    );
    const messages = await listForTicket(pool, ticket_id);

    const ticketData = buildTicketDetails(viewer, ticketRow, {
      attachments, reports, tenders, bills, auditLogs, messages,
    });

    // The buttons the UI may render come from the same state machine that
    // enforces them on POST /actions (fixes F3: no hardcoded ceilings in the UI).
    // Only a viewer with a staff view can hold a desk; the applicant view gets none.
    if (staffRole(viewer, ticketRow) !== null) {
      ticketData.open_change_request_id = ticketRow.open_change_request_id ?? null;
      const ctx = await loadActionContext(pool, ticketRow, { id: userId, role: userRole });
      ticketData.available_actions = availableActions({ id: userId, role: userRole }, ctx.ticket, ctx.limits);
      // Limits and lower-desk names for the UI: it must never hardcode either (F3).
      if (ticketData.available_actions.actions.length > 0) {
        ticketData.approval_limit = approvalLimitFor(ticketData.available_actions.desk, ctx.limits);
        const people = {};
        for (const d of ctx.ticket.desk_owners ? Object.keys(ctx.ticket.desk_owners) : []) {
          const owner = await findDeskOwner(pool, ticketRow, d);
          if (owner) people[d] = owner.name;
        }
        ticketData.desk_people = people;
      }
    } else {
      ticketData.available_actions = { desk: null, actions: [] };
    }

    res.json({ success: true, ticket: ticketData });
  } catch (error) {
    return sendServerError(req, res, error, 'getTicketDetails error');
  }
});

export default router;
