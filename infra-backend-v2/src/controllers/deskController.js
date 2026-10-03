// Role dashboards ("My desk" / "Watching" / "My tickets") and the AE's JE
// picker for UNASSIGNED tickets (plan.md §3.5, §4 Phase 7).
//
// Zero-trust: every list is keyed off the verified token's user id. "My
// tickets" goes through the applicant projection, so it can never carry a
// staff name, phone or estimate.
import pool from '../config/db.js';
import { STATUS, DESK_RANK, approvalLimitFor, deskForStatus } from '../config/workflow.js';
import { loadLimits } from '../models/limitsModel.js';
import { applicantTicket } from '../services/visibility.js';
import { sendServerError } from '../utils/httpError.js';

const TERMINAL = [STATUS.CLOSED, STATUS.DENIED];

// Statuses each role works on. AE also owns the UNASSIGNED queue (Q8).
const DESK_STATUSES = Object.freeze({
  // After approval the ticket comes back to its JE to execute and mark complete.
  JE: [STATUS.ASSIGNED_TO_JE, STATUS.RETURNED_TO_JE,
    STATUS.APPROVED_FOR_TENDERING, STATUS.TENDER_PUBLISHED, STATUS.TECHNICAL_EVALUATION,
    STATUS.FINANCIAL_EVALUATION, STATUS.WORK_IN_PROGRESS],
  AE: [STATUS.UNASSIGNED, STATUS.PENDING_AE_APPROVAL],
  SE: [STATUS.PENDING_SE_APPROVAL],
  DEAN: [STATUS.PENDING_DEAN_APPROVAL],
  DIRECTOR: [STATUS.PENDING_DIRECTOR_APPROVAL],
});

const ROW_SELECT = `
  SELECT t.id, t.title, t.department, t.campus, t.priority, t.status, t.created_at, t.applicant_id,
         COALESCE(t.status_changed_at, t.assigned_at, t.created_at) AS desk_since,
         t.open_change_request_id, t.current_desk_user_id, hu.name AS current_holder_name, r.estimated_amount,
         t.resolved_at, t.resolution_kind, t.applicant_sent_back_at, t.reopen_count,
         (SELECT m.body FROM infra_ticket_messages m JOIN infra_audit_logs al ON al.id = m.audit_log_id
           WHERE m.ticket_id = t.id AND al.action = 'WORK_REOPENED' ORDER BY m.id DESC LIMIT 1) AS sent_back_comment
    FROM infra_tickets t
    LEFT JOIN infra_users hu ON hu.id = t.current_desk_user_id
    LEFT JOIN infra_reports r ON r.ticket_id = t.id
     AND r.id = (SELECT MAX(r2.id) FROM infra_reports r2 WHERE r2.ticket_id = t.id)`;

export const getDeskBoard = async (req, res) => {
  const { id: userId, role } = req.user;
  try {
    let myDesk = [];
    const statuses = DESK_STATUSES[role];
    if (statuses) {
      let owner;
      let params;
      if (role === 'JE') {
        owner = 't.assigned_je_id = ?';
        params = [userId];
      } else if (role === 'AE') {
        // Own desk, plus every UNASSIGNED ticket inside this AE's scope.
        owner = `(t.current_desk_user_id = ? OR (t.status = 'UNASSIGNED' AND EXISTS (
                   SELECT 1 FROM infra_user_scopes s
                    WHERE s.user_id = ? AND s.department = t.department
                      AND (t.campus IS NULL OR s.campus IN (t.campus, 'BOTH')))))`;
        params = [userId, userId];
      } else {
        owner = 't.current_desk_user_id = ?';
        params = [userId];
      }
      [myDesk] = await pool.query(
        `${ROW_SELECT} WHERE t.is_mock = FALSE AND t.deleted_at IS NULL AND t.status IN (?) AND ${owner} ORDER BY desk_since ASC LIMIT 200`,
        [statuses, ...params]
      );
    }
    // A resolved ticket waiting for ME to confirm it, when I did not raise it (the JE raised it, so the
    // AE confirms): it is an action for my desk. When I raised it, it shows at the top of my own list.
    if (role !== 'APPLICANT') {
      const [toConfirm] = await pool.query(
        `${ROW_SELECT} WHERE t.is_mock = FALSE AND t.deleted_at IS NULL AND t.status = ? AND t.current_desk_user_id = ? AND t.applicant_id <> ?
          ORDER BY desk_since ASC LIMIT 100`,
        [STATUS.WORK_COMPLETED, userId, userId]);
      myDesk = [...myDesk, ...toConfirm.filter((t) => !myDesk.some((m) => m.id === t.id))];
    }
    const onDesk = new Set(myDesk.map((t) => t.id));

    // The two sections (Master plan 7.4), for the people who deal with the ticket: the JE, an AE in scope,
    // and anyone who acted on it. Same scope rules as "watching".
    let awaitingConfirmation = [];
    let sentBack = [];
    if (role !== 'APPLICANT' && role !== 'SYSADMIN') {
      const involved = `(t.assigned_je_id = ? OR t.assigned_ae_id = ? OR t.assigned_se_id = ? OR t.current_desk_user_id = ?
        OR EXISTS (SELECT 1 FROM infra_audit_logs a WHERE a.ticket_id = t.id AND a.user_id = ? AND a.action <> 'REMINDER_SENT')
        OR (? = 'AE' AND EXISTS (SELECT 1 FROM infra_user_scopes s
              WHERE s.user_id = ? AND s.department = t.department AND (t.campus IS NULL OR s.campus IN (t.campus, 'BOTH')))))`;
      const p = [userId, userId, userId, userId, userId, role, userId];
      [awaitingConfirmation] = await pool.query(
        `${ROW_SELECT} WHERE t.is_mock = FALSE AND t.deleted_at IS NULL AND t.status = ? AND ${involved} ORDER BY t.resolved_at ASC LIMIT 100`,
        [STATUS.WORK_COMPLETED, ...p]);
      [sentBack] = await pool.query(
        `${ROW_SELECT} WHERE t.is_mock = FALSE AND t.deleted_at IS NULL AND t.applicant_sent_back_at IS NOT NULL AND t.status NOT IN (?) AND ${involved}
          ORDER BY t.applicant_sent_back_at DESC LIMIT 100`,
        [[STATUS.WORK_COMPLETED, STATUS.CLOSED, STATUS.DENIED], ...p]);
    }

    // Tickets I acted on that have moved on. Staff only, and never the ones I
    // merely raised (those are "my tickets", which go through the applicant
    // projection): a plain applicant must not receive staff-shaped rows.
    let watching = [];
    if (role !== 'APPLICANT') {
      const [watchRows] = await pool.query(
        `${ROW_SELECT}
          WHERE t.is_mock = FALSE AND t.deleted_at IS NULL AND t.status NOT IN (?) AND t.applicant_id <> ?
            AND EXISTS (SELECT 1 FROM infra_audit_logs a
                         WHERE a.ticket_id = t.id AND a.user_id = ? AND a.action <> 'REMINDER_SENT')
          ORDER BY desk_since DESC LIMIT 100`,
        [TERMINAL, userId, userId]
      );
      watching = watchRows.filter((t) => !onDesk.has(t.id));
    }

    const [mine] = await pool.query(
      'SELECT * FROM infra_tickets WHERE applicant_id = ? AND is_mock = FALSE AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200', [userId]);

    // on_my_desk = I can act now (an AE in scope also SEES other AEs' UNASSIGNED tickets).
    const strip = ({ current_desk_user_id, applicant_id, ...rest }) => ({ ...rest, current_desk: deskForStatus(rest.status) });
    const mark = (t) => ({
      ...strip(t),
      on_my_desk: role === 'AE' || role === 'SE' || role === 'DEAN' || role === 'DIRECTOR'
        ? t.current_desk_user_id === userId
        : true,
    });

    const limit = DESK_RANK[role] ? approvalLimitFor(role, await loadLimits(pool)) : null;

    res.json({
      success: true,
      my_desk: myDesk.map(mark),
      watching: watching.map(strip),
      awaiting_confirmation: awaitingConfirmation.map(strip),
      sent_back: sentBack.map(strip),
      // Raised by me and resolved: waiting for my answer. Listed first.
      my_tickets: mine
        .map((t) => ({ ...applicantTicket(t), needs_confirmation: t.status === STATUS.WORK_COMPLETED && t.current_desk_user_id === userId }))
        .sort((a, b) => Number(b.needs_confirmation) - Number(a.needs_confirmation)),
      approval_limit: limit,
    });
  } catch (error) {
    return sendServerError(req, res, error, 'getDeskBoard error');
  }
};

// The JE picker behind ASSIGN_JE. Only the person holding the UNASSIGNED
// ticket may list candidates; anyone else gets 404, like a missing ticket.
export const getAssignableJes = async (req, res) => {
  const ticketId = Number.parseInt(req.params.ticket_id, 10);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ success: false, message: 'ticket_id must be a positive integer.' });
  }
  try {
    const [rows] = await pool.query(
      'SELECT id, department, campus, status, current_desk_user_id FROM infra_tickets WHERE id = ?', [ticketId]);
    const t = rows[0];
    if (!t || t.status !== STATUS.UNASSIGNED || t.current_desk_user_id !== req.user.id) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    const [jes] = await pool.query(
      `SELECT u.id, u.name,
              (SELECT COUNT(*) FROM infra_tickets x
                WHERE x.assigned_je_id = u.id AND x.deleted_at IS NULL AND x.status IN ('ASSIGNED_TO_JE','RETURNED_TO_JE')) AS open_tickets,
              EXISTS (SELECT 1 FROM infra_user_availability a
                       WHERE a.user_id = u.id AND NOW() BETWEEN a.start_at AND a.end_at) AS on_leave,
              EXISTS (SELECT 1 FROM infra_user_scopes s
                       WHERE s.user_id = u.id AND s.department = ? AND (? IS NULL OR s.campus IN (?, 'BOTH'))) AS same_campus
         FROM infra_users u
        WHERE u.role = 'JE' AND u.is_active = TRUE
          AND EXISTS (SELECT 1 FROM infra_user_scopes s WHERE s.user_id = u.id AND s.department = ?)
        ORDER BY on_leave ASC, same_campus DESC, open_tickets ASC, u.name ASC`,
      [t.department, t.campus ?? null, t.campus ?? null, t.department]
    );
    res.json({
      success: true,
      jes: jes.map((j) => ({
        id: j.id, name: j.name, open_tickets: Number(j.open_tickets),
        on_leave: !!j.on_leave, same_campus: !!j.same_campus,
      })),
    });
  } catch (error) {
    return sendServerError(req, res, error, 'getAssignableJes error');
  }
};
