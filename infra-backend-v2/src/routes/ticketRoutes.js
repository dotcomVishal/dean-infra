import express from 'express';
import pool from '../config/db.js';
import { uploadArray, uploadFields } from '../middleware/upload.js';
import { requireAuth } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimit.js';
import { requireRole } from '../middleware/rbac.js';
import { testRoleForTicketParam, rejectStrayTestRole } from '../middleware/testRole.js';
import { hideDeletedTicketParam } from '../middleware/ticketGuard.js';

// Import actual controllers
import {
  createTicket,
  getQueue,
  submitReport,
  uploadAttachments,
  checkUploadAllowed,
  confirmCompletion,
} from '../controllers/ticketController.js';
import { performTicketAction } from '../controllers/actionController.js';
import { performLifecycleAction } from '../controllers/lifecycleController.js';
import { getDeskBoard, getAssignableJes } from '../controllers/deskController.js';
import {
  availableActions, availableLifecycleActions, approvalLimitFor, AUTO_CLOSE_DAYS, RESOLUTION, STATUS,
} from '../config/workflow.js';
import { findDeskOwner, loadAssignees } from '../models/deskModel.js';
import { loadActionContext } from '../services/actionContext.js';
import { listForTicket } from '../models/messageModel.js';
import {
  loadViewer, canViewTicket, staffRole, capabilities, applicantTicket, buildTicketDetails,
} from '../services/visibility.js';
import { sendServerError } from '../utils/httpError.js';

const router = express.Router();

// EVERY route below this line requires a valid token
router.use(requireAuth, userLimiter);

// Sysadmin "act as" on mock tickets only (plan2.md F5). Runs before any route-level requireRole.
router.use(rejectStrayTestRole);
router.param('ticket_id', testRoleForTicketParam);
// A deleted ticket answers 404 on every route below, exactly like a missing id.
router.param('ticket_id', hideDeletedTicketParam);

// 1.5 Applicant Dashboard (Fetch tickets created by this specific user)
// W15: "My tickets" is open to every authenticated, active role -- being the
// applicant is a relation (tickets.applicant_id), not a role restriction.
router.get('/applicant', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM infra_tickets WHERE applicant_id = ? AND is_mock = FALSE AND deleted_at IS NULL ORDER BY created_at DESC`,
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
// staff and every internal role (AE/SE/Dean/Director), not
// just APPLICANT/JE/SYSADMIN.
router.post('/', uploadArray('files', 5), createTicket);

// 2. Role Dashboard Queue (Supports AE, SE, DEAN, DIRECTOR, SYSADMIN)
router.get(
  '/queue',
  requireRole(['AE', 'SE', 'DEAN', 'DIRECTOR', 'SYSADMIN']),
  getQueue
);

// 3. JE Site report + estimate (Supports dual file uploads: site_photos and estimate_docs)
router.post(
  '/:ticket_id/report',
  requireRole(['JE']),
  uploadFields([
    { name: 'site_photos', maxCount: 10 },
    { name: 'estimate_docs', maxCount: 10 },
  ]),
  submitReport
);

// 4. JE steps after approval: publish tender, evaluations, award, cancel tender, resolve.
//    Files may travel with the step (completion photos).
router.post('/:ticket_id/lifecycle', requireRole(['JE']), uploadArray('files', 5), performLifecycleAction);

// 4.1 Files from any desk (applicant, JE, AE..Director).
// The controller checks ticket access and picks the category from the uploader.
router.post('/:ticket_id/attachments', checkUploadAllowed, uploadArray('files', 10), uploadAttachments);

// 4.2 Applicant confirms (closes) or disputes work the JE marked complete.
router.post('/:ticket_id/confirm-completion', confirmCompletion);

// 4.5 Desk actions (replaces /review): FORWARD, APPROVE, REQUEST_CHANGES,
// REJECT, ASSIGN_JE. The route only gates the role; the state machine decides
// whether THIS person may do THIS action on THIS ticket right now.
router.post('/:ticket_id/actions', requireRole(['AE', 'SE', 'DEAN', 'DIRECTOR']), uploadArray('files', 5), performTicketAction);

// 4.6 JE picker for the AE's ASSIGN_JE action on an UNASSIGNED ticket.
router.get('/:ticket_id/assignable-jes', requireRole(['AE']), getAssignableJes);

// 5. JE Dashboard (Securely uses token ID, no payload spoofing)
router.get('/je/dashboard', requireRole(['JE']), async (req, res) => {
  const je_id = req.user.id;
  try {
    const [tickets] = await pool.query(
      `SELECT t.*, u.name as applicant_name, u.phone as applicant_phone, u.email as applicant_email,
              r.estimated_amount, r.nature_of_work,
              (SELECT m.body FROM infra_ticket_messages m JOIN infra_audit_logs al ON al.id = m.audit_log_id
                WHERE m.ticket_id = t.id AND al.action = 'WORK_REOPENED' ORDER BY m.id DESC LIMIT 1) AS sent_back_comment
       FROM infra_tickets t 
       JOIN infra_users u ON t.applicant_id = u.id 
       LEFT JOIN (
         SELECT r1.* FROM infra_reports r1
         JOIN (SELECT ticket_id, MAX(id) as max_id FROM infra_reports GROUP BY ticket_id) r2
         ON r1.id = r2.max_id
       ) r ON t.id = r.ticket_id
       WHERE t.assigned_je_id = ? AND t.deleted_at IS NULL
       ORDER BY t.created_at DESC`,
      [je_id]
    );
    res.json({ success: true, tickets });
  } catch (error) {
    return sendServerError(req, res, error, 'ticketRoutes:109');
  }
});

// -------------------------------------------------------------
// 6. TENDER READ
// -------------------------------------------------------------
// S6: previously unauthenticated-in-effect -- no role or scope check meant an
// APPLICANT could read tender data for any ticket id.
router.get(
  '/:ticket_id/tenders',
  requireRole(['JE', 'AE', 'SE', 'DEAN', 'DIRECTOR', 'SYSADMIN']),
  async (req, res) => {
    const { ticket_id } = req.params;
    try {
      const [ticketRows] = await pool.query(
        `SELECT id, applicant_id, department, campus, status, assigned_je_id, assigned_ae_id, assigned_se_id,
                is_mock, current_desk_user_id
           FROM infra_tickets WHERE id = ?`,
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
         FROM infra_tenders tn
         JOIN infra_users u ON tn.created_by = u.id
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
// 8. TICKET DETAILS -- every redaction decision lives in services/visibility.js
// -------------------------------------------------------------
router.get('/:ticket_id/details', async (req, res) => {
  const { ticket_id } = req.params;
  const userRole = req.user.role;
  const userId = req.user.id;

  try {
    const [tickets] = await pool.query(
      `SELECT t.*, u.name as applicant_name, u.email as applicant_email, u.phone as applicant_phone
       FROM infra_tickets t JOIN infra_users u ON t.applicant_id = u.id WHERE t.id = ?`,
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
      `SELECT a.id, a.file_url, a.original_name, a.uploaded_by, a.created_at, a.document_category, a.report_id,
              a.uploader_desk, a.audit_log_id, al.action AS audit_action,
              u.role AS uploader_role, u.name AS uploader_name
         FROM infra_attachments a
         LEFT JOIN infra_users u ON u.id = a.uploaded_by
         LEFT JOIN infra_audit_logs al ON al.id = a.audit_log_id
        WHERE a.ticket_id = ? ORDER BY a.created_at ASC, a.id ASC`,
      [ticket_id]
    );
    const [reports] = await pool.query(
      'SELECT * FROM infra_reports WHERE ticket_id = ? ORDER BY version DESC LIMIT 1', [ticket_id]);

    let tenders = [];
    try {
      [tenders] = await pool.query('SELECT * FROM infra_tenders WHERE ticket_id = ? ORDER BY created_at DESC', [ticket_id]);
    } catch (err) {
      if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
    }

    const [auditLogs] = await pool.query(
      `SELECT a.action, a.remarks, a.created_at, a.user_id, a.visibility, a.from_desk, a.to_desk, a.is_self_action,
              u.name as actor_name, u.role as actor_role
         FROM infra_audit_logs a JOIN infra_users u ON a.user_id = u.id
        WHERE a.ticket_id = ? ORDER BY a.created_at ASC, a.id ASC`,
      [ticket_id]
    );
    const messages = await listForTicket(pool, ticket_id);

    const ticketData = buildTicketDetails(viewer, ticketRow, {
      attachments, reports, tenders, auditLogs, messages,
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
      ticketData.assignees = await loadAssignees(pool, ticketRow, staffRole(viewer, ticketRow));
      // The JE's steps after approval, from the same table the server enforces.
      ticketData.available_lifecycle_actions = availableLifecycleActions({ user: { id: userId, role: userRole }, ticket: ticketRow });
    } else {
      ticketData.available_actions = { desk: null, actions: [] };
      ticketData.available_lifecycle_actions = [];
    }

    // The stored confirmer of a resolved ticket gets the confirm panel, on the staff page as well as
    // the applicant page (a person who raised a ticket and also has a staff view could not answer before).
    if (ticketRow.status === STATUS.WORK_COMPLETED && ticketRow.current_desk_user_id === userId) {
      ticketData.confirmation = {
        can_confirm: true,
        can_send_back: ticketRow.resolution_kind !== RESOLUTION.TENDER_CANCELLED,
        resolution_kind: ticketRow.resolution_kind,
        auto_close_at: ticketRow.resolved_at
          ? new Date(new Date(ticketRow.resolved_at).getTime() + AUTO_CLOSE_DAYS * 24 * 3600 * 1000).toISOString() : null,
      };
    }

    res.json({ success: true, ticket: ticketData });
  } catch (error) {
    return sendServerError(req, res, error, 'getTicketDetails error');
  }
});

export default router;
