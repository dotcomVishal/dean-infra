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
    STATUS.APPROVED_FOR_TENDERING, STATUS.TENDER_PUBLISHED, STATUS.WORK_IN_PROGRESS],
  AE: [STATUS.UNASSIGNED, STATUS.PENDING_AE_APPROVAL],
  SE: [STATUS.PENDING_SE_APPROVAL],
  DEAN: [STATUS.PENDING_DEAN_APPROVAL],
  DIRECTOR: [STATUS.PENDING_DIRECTOR_APPROVAL],
  CLERICAL: [STATUS.APPROVED_FOR_TENDERING, STATUS.TENDER_PUBLISHED],
  ACCOUNTANT: [STATUS.WORK_IN_PROGRESS, STATUS.WORK_COMPLETED],
});

const ROW_SELECT = `
  SELECT t.id, t.title, t.department, t.campus, t.priority, t.status, t.created_at,
         COALESCE(t.status_changed_at, t.assigned_at, t.created_at) AS desk_since,
         t.open_change_request_id, t.current_desk_user_id, hu.name AS current_holder_name, r.estimated_amount
    FROM tickets t
    LEFT JOIN users hu ON hu.id = t.current_desk_user_id
    LEFT JOIN reports r ON r.ticket_id = t.id
     AND r.id = (SELECT MAX(r2.id) FROM reports r2 WHERE r2.ticket_id = t.id)`;

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
      } else if (role === 'CLERICAL' || role === 'ACCOUNTANT') {
        owner = '1 = 1'; // post-approval work is shared by the whole desk
        params = [];
      } else if (role === 'AE') {
        // Own desk, plus every UNASSIGNED ticket inside this AE's scope.
        owner = `(t.current_desk_user_id = ? OR (t.status = 'UNASSIGNED' AND EXISTS (
                   SELECT 1 FROM user_scopes s
                    WHERE s.user_id = ? AND s.department = t.department COLLATE utf8mb4_unicode_ci
                      AND (t.campus IS NULL OR s.campus IN (t.campus COLLATE utf8mb4_unicode_ci, 'BOTH')))))`;
        // COLLATE: tickets and user_scopes were created with different default
        // collations on some servers; comparing the two columns bare raises
        // ER_CANT_AGGREGATE_2COLLATIONS.
        params = [userId, userId];
      } else {
        owner = 't.current_desk_user_id = ?';
        params = [userId];
      }
      [myDesk] = await pool.query(
        `${ROW_SELECT} WHERE t.is_mock = FALSE AND t.status IN (?) AND ${owner} ORDER BY desk_since ASC LIMIT 200`,
        [statuses, ...params]
      );
    }
    const onDesk = new Set(myDesk.map((t) => t.id));

    // Tickets I acted on that have moved on. Staff only, and never the ones I
    // merely raised (those are "my tickets", which go through the applicant
    // projection): a plain applicant must not receive staff-shaped rows.
    let watching = [];
    if (role !== 'APPLICANT') {
      const [watchRows] = await pool.query(
        `${ROW_SELECT}
          WHERE t.is_mock = FALSE AND t.status NOT IN (?) AND t.applicant_id <> ?
            AND EXISTS (SELECT 1 FROM audit_logs a
                         WHERE a.ticket_id = t.id AND a.user_id = ? AND a.action <> 'REMINDER_SENT')
          ORDER BY desk_since DESC LIMIT 100`,
        [TERMINAL, userId, userId]
      );
      watching = watchRows.filter((t) => !onDesk.has(t.id));
    }

    const [mine] = await pool.query(
      'SELECT * FROM tickets WHERE applicant_id = ? AND is_mock = FALSE ORDER BY created_at DESC LIMIT 200', [userId]);

    // on_my_desk = I can act now (an AE in scope also SEES other AEs' UNASSIGNED tickets).
    const strip = ({ current_desk_user_id, ...rest }) => ({ ...rest, current_desk: deskForStatus(rest.status) });
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
      my_tickets: mine.map(applicantTicket),
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
      'SELECT id, department, campus, status, current_desk_user_id FROM tickets WHERE id = ?', [ticketId]);
    const t = rows[0];
    if (!t || t.status !== STATUS.UNASSIGNED || t.current_desk_user_id !== req.user.id) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    const [jes] = await pool.query(
      `SELECT u.id, u.name,
              (SELECT COUNT(*) FROM tickets x
                WHERE x.assigned_je_id = u.id AND x.status IN ('ASSIGNED_TO_JE','RETURNED_TO_JE')) AS open_tickets,
              EXISTS (SELECT 1 FROM user_availability a
                       WHERE a.user_id = u.id AND NOW() BETWEEN a.start_at AND a.end_at) AS on_leave,
              EXISTS (SELECT 1 FROM user_scopes s
                       WHERE s.user_id = u.id AND s.department = ? AND (? IS NULL OR s.campus IN (?, 'BOTH'))) AS same_campus
         FROM users u
        WHERE u.role = 'JE' AND u.is_active = TRUE
          AND EXISTS (SELECT 1 FROM user_scopes s WHERE s.user_id = u.id AND s.department = ?)
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
