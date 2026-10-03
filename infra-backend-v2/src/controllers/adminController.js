import fs from 'fs';
import path from 'path';
import { uploadRoot } from '../utils/fileManager.js';
import pool from '../config/db.js';
import { STATUS, STATUS_LABEL, WorkflowError, deskForStatus, POST_APPROVAL_STATUSES, AUTO_CLOSE_DAYS } from '../config/workflow.js';
import { buildTicketFilter, FilterError } from '../services/ticketFilter.js';
import { BOM, csvRow } from '../utils/csv.js';
import logger, { errorFields } from '../utils/logger.js';
import { resolveDeskOwner, loadAssignees, reconcileDeskOwners } from '../models/deskModel.js';
import { insertAudit } from '../models/auditModel.js';
import { checkSingleHolders } from '../services/deskHealth.js';
import { pinsFor, isSelfAction } from './actionController.js';
import { notifyAdminOverride, notifyResolved } from '../services/notifier.js';
import { pickConfirmer } from './lifecycleController.js';
import { kickOutbox } from '../cron/emailReminders.js';
import { sendServerError } from '../utils/httpError.js';

// 1. System Overview Metrics
export const getAdminMetrics = async (req, res) => {
  try {
    // Ticket status counts
    const [statusCounts] = await pool.query(`
      SELECT status, COUNT(*) as count FROM infra_tickets WHERE is_mock = FALSE AND deleted_at IS NULL GROUP BY status
    `);

    // Department counts
    const [deptCounts] = await pool.query(`
      SELECT department, COUNT(*) as count FROM infra_tickets WHERE is_mock = FALSE AND deleted_at IS NULL GROUP BY department
    `);

    // Work type counts
    const [typeCounts] = await pool.query(`
      SELECT type, COUNT(*) as count FROM infra_tickets WHERE is_mock = FALSE AND deleted_at IS NULL GROUP BY type
    `);

    // User counts by role
    const [userRoleCounts] = await pool.query(`
      SELECT role, COUNT(*) as count, SUM(CASE WHEN is_active = TRUE THEN 1 ELSE 0 END) as active_count 
      FROM infra_users GROUP BY role
    `);

    // Money. Once a tender is awarded the AWARD AMOUNT counts, not the estimate. Tickets not yet awarded are
    // reported apart as "estimated" (latest report); a cancelled tender contributes nothing to either.
    const [[awardedRow]] = await pool.query(`
      SELECT COALESCE(SUM(tn.award_amount), 0) AS total_awarded_amount
        FROM infra_tenders tn JOIN infra_tickets t ON t.id = tn.ticket_id
       WHERE tn.status = 'AWARDED' AND t.is_mock = FALSE AND t.deleted_at IS NULL
    `);
    const [[estimatedRow]] = await pool.query(`
      SELECT COALESCE(SUM(r.estimated_amount), 0) AS total_estimated_amount
        FROM infra_reports r
        JOIN (SELECT ticket_id, MAX(id) AS max_id FROM infra_reports GROUP BY ticket_id) r_latest ON r.id = r_latest.max_id
        JOIN infra_tickets t ON t.id = r.ticket_id
        LEFT JOIN infra_tenders tn ON tn.ticket_id = t.id
       WHERE t.is_mock = FALSE AND t.deleted_at IS NULL AND t.status NOT IN ('DENIED')
         AND (tn.id IS NULL OR tn.status NOT IN ('AWARDED', 'CANCELLED'))
    `);

    // JE Workloads
    const [jeWorkloads] = await pool.query(`
      SELECT u.id, u.name as full_name, u.email, u.department, COUNT(t.id) as active_tickets_count
      FROM infra_users u
      LEFT JOIN infra_tickets t ON u.id = t.assigned_je_id AND t.status NOT IN ('CLOSED', 'DENIED') AND t.is_mock = FALSE AND t.deleted_at IS NULL
      WHERE u.role = 'JE' AND u.is_active = TRUE
      GROUP BY u.id, u.name, u.email, u.department
      ORDER BY active_tickets_count DESC
    `);

    // Total ticket count
    const [totalTicketsRow] = await pool.query(`SELECT COUNT(*) as total FROM infra_tickets WHERE is_mock = FALSE AND deleted_at IS NULL`);
    const [totalUsersRow] = await pool.query(`SELECT COUNT(*) as total FROM infra_users`);

    // Calculate stage groups
    let pendingInspection = 0;
    let awaitingApproval = 0;
    let inTendering = 0;
    let awaitingConfirmation = 0;
    let closed = 0;

    for (const row of statusCounts) {
      const s = row.status || '';
      const c = Number(row.count) || 0;
      if (s === 'ASSIGNED_TO_JE' || s === 'RETURNED_TO_JE') {
        pendingInspection += c;
      } else if (s.startsWith('PENDING_')) {
        awaitingApproval += c;
      } else if (s === STATUS.WORK_COMPLETED) {
        awaitingConfirmation += c;
      } else if (POST_APPROVAL_STATUSES.includes(s) && s !== STATUS.CLOSED) {
        inTendering += c;
      } else if (s === 'CLOSED') {
        closed += c;
      }
    }

    const [[sentBackRow]] = await pool.query(`
      SELECT COUNT(*) AS n FROM infra_tickets
       WHERE is_mock = FALSE AND deleted_at IS NULL AND applicant_sent_back_at IS NOT NULL AND status NOT IN ('WORK_COMPLETED', 'CLOSED', 'DENIED')
    `);
    const deskHealth = await checkSingleHolders(pool);
    const [[selfRow]] = await pool.query(`
      SELECT COUNT(*) AS n FROM infra_audit_logs a JOIN infra_tickets t ON t.id = a.ticket_id
       WHERE a.is_self_action = TRUE AND t.is_mock = FALSE AND t.deleted_at IS NULL AND a.created_at >= NOW() - INTERVAL 30 DAY
    `);

    const byDepartment = deptCounts.map(d => ({ department: d.department, count: Number(d.count) }));
    const byStatus = statusCounts.map(s => ({ status: s.status, count: Number(s.count) }));

    res.json({
      success: true,
      metrics: {
        totalTickets: totalTicketsRow[0]?.total || 0,
        totalUsers: totalUsersRow[0]?.total || 0,
        usersCount: totalUsersRow[0]?.total || 0,
        totalAwardedAmount: parseFloat(awardedRow.total_awarded_amount || 0),
        totalSanctionedAmount: parseFloat(awardedRow.total_awarded_amount || 0),
        totalApprovedAmount: parseFloat(awardedRow.total_awarded_amount || 0),
        totalEstimatedAmount: parseFloat(estimatedRow.total_estimated_amount || 0),
        awaitingConfirmation,
        sentBack: Number(sentBackRow.n),
        pendingInspection,
        awaitingApproval,
        inTendering,
        closed,
        byDepartment,
        byStatus,
        activeJes: jeWorkloads,
        statusCounts,
        deptCounts,
        typeCounts,
        userRoleCounts,
        jeWorkloads,
        selfActions30d: Number(selfRow.n),
      },
      desk_health: deskHealth,
    });
  } catch (error) {
    return sendServerError(req, res, error, 'getAdminMetrics error');
  }
};

// 2. Master Tickets Query (filters, search, paging) and its CSV export share one filter (services/ticketFilter.js),
//    so the file always equals the filtered list.
const TICKET_JOINS = `
    FROM infra_tickets t
    JOIN infra_users u_app ON t.applicant_id = u_app.id
    LEFT JOIN infra_users u_je ON t.assigned_je_id = u_je.id
    LEFT JOIN infra_users u_hold ON t.current_desk_user_id = u_hold.id
    LEFT JOIN infra_tenders tn ON tn.ticket_id = t.id
    LEFT JOIN (
      SELECT r1.* FROM infra_reports r1
      JOIN (SELECT ticket_id, MAX(id) as max_id FROM infra_reports GROUP BY ticket_id) r2
      ON r1.id = r2.max_id
    ) r ON t.id = r.ticket_id`;

const badFilter = (res, error) => res.status(400).json({
  success: false, code: 'VALIDATION_ERROR', message: error.message, errors: error.issues,
});

export const getAllTickets = async (req, res) => {
  let filter;
  try {
    filter = buildTicketFilter(req.query);
  } catch (error) {
    if (error instanceof FilterError) return badFilter(res, error);
    throw error;
  }
  const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const offset = (pageNum - 1) * limitNum;

  const query = `
    SELECT
      t.id, t.title, t.department, t.campus, t.priority, t.type, t.description, t.landmark, t.status, t.created_at,
      t.is_mock, t.deleted_at, t.resolution_kind, t.resolved_at, t.applicant_sent_back_at, t.reopen_count,
      u_hold.name as current_holder_name,
      u_app.name as applicant_name, u_app.email as applicant_email, u_app.phone as applicant_phone,
      u_je.name as je_name, u_je.email as je_email,
      r.estimated_amount, r.nature_of_work, tn.award_amount,
      (SELECT COUNT(*) FROM infra_attachments a WHERE a.ticket_id = t.id) as attachment_count
    ${TICKET_JOINS}
    WHERE ${filter.whereSql}
    ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`;

  try {
    const [[{ count }]] = await pool.query(
      `SELECT COUNT(*) AS count ${TICKET_JOINS} WHERE ${filter.whereSql}`, filter.params);
    const [tickets] = await pool.query(query, [...filter.params, limitNum, offset]);
    res.json({ success: true, total: count, page: pageNum, limit: limitNum, tickets });
  } catch (error) {
    return sendServerError(req, res, error, 'getAllTickets error');
  }
};

export const EXPORT_MAX_ROWS = 50_000;
const EXPORT_BATCH = 1000;
export const EXPORT_COLUMNS = [
  'ID', 'Title', 'Status', 'Stage label', 'Campus', 'Department', 'Priority', 'Type', 'Landmark',
  'Raised by (name)', 'Raised by (email)', 'Assigned JE', 'Current holder', 'Latest estimate', 'Award amount',
  'Resolution kind', 'Created', 'Last status change', 'Resolved', 'Closed', 'Sent back count', 'Test ticket', 'Deleted',
];
// Times in the CSV are IST ("2026-09-30 14:10"); stored times are UTC.
const istStamp = (d) => {
  if (!d) return null;
  const t = new Date(new Date(d).getTime() + 330 * 60 * 1000).toISOString();
  return `${t.slice(0, 10)} ${t.slice(11, 16)}`;
};
const num = (v) => (v === null || v === undefined ? null : Number(v));

export const exportTicketsCsv = async (req, res) => {
  let filter;
  try {
    filter = buildTicketFilter(req.query);
  } catch (error) {
    if (error instanceof FilterError) return badFilter(res, error);
    throw error;
  }
  try {
    const [[{ count }]] = await pool.query(
      `SELECT COUNT(*) AS count ${TICKET_JOINS} WHERE ${filter.whereSql}`, filter.params);
    if (count > EXPORT_MAX_ROWS) {
      return res.status(400).json({
        success: false, code: 'EXPORT_TOO_LARGE',
        message: `${count} tickets match; the export holds at most ${EXPORT_MAX_ROWS}. Narrow the filter.`,
      });
    }

    const stamp = istStamp(new Date()).slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tickets-${stamp}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.write(BOM + csvRow(EXPORT_COLUMNS));

    // Batches of 1000 by id: memory stays flat however many rows match.
    let lastId = 0;
    let written = 0;
    for (;;) {
      const [rows] = await pool.query(
        `SELECT t.id, t.title, t.status, t.campus, t.department, t.priority, t.type, t.landmark, t.created_at,
                t.status_changed_at, t.resolved_at, t.closed_at, t.resolution_kind, t.reopen_count, t.is_mock, t.deleted_at,
                u_app.name AS applicant_name, u_app.email AS applicant_email, u_je.name AS je_name, u_hold.name AS holder_name,
                r.estimated_amount, tn.award_amount
           ${TICKET_JOINS}
          WHERE ${filter.whereSql} AND t.id > ?
          ORDER BY t.id ASC LIMIT ?`,
        [...filter.params, lastId, EXPORT_BATCH]);
      if (rows.length === 0) break;
      let chunk = '';
      for (const t of rows) {
        chunk += csvRow([
          t.id, t.title, t.status, STATUS_LABEL[t.status] ?? t.status, t.campus, t.department, t.priority, t.type, t.landmark,
          t.applicant_name, t.applicant_email, t.je_name, t.holder_name, num(t.estimated_amount), num(t.award_amount),
          t.resolution_kind, istStamp(t.created_at), istStamp(t.status_changed_at), istStamp(t.resolved_at), istStamp(t.closed_at),
          t.reopen_count, !!t.is_mock, !!t.deleted_at,
        ]);
      }
      res.write(chunk);
      written += rows.length;
      lastId = rows[rows.length - 1].id;
      if (rows.length < EXPORT_BATCH) break;
    }
    logger.info('ticket export', { userId: req.user.id, filter: req.query, rows: written });
    return res.end();
  } catch (error) {
    // Headers may already be sent (a failure mid-stream): then the connection is cut and the log says why.
    if (res.headersSent) {
      logger.error('ticket export failed mid-stream', { userId: req.user.id, ...errorFields(error) });
      return res.destroy(error);
    }
    return sendServerError(req, res, error, 'exportTicketsCsv error');
  }
};

// 3. Unredacted Ticket Details & Master Timeline
export const getTicketMasterDetails = async (req, res) => {
  const { ticket_id } = req.params;

  try {
    const [tickets] = await pool.query(`
      SELECT 
        t.*,
        u_app.name as applicant_name, u_app.email as applicant_email, u_app.phone as applicant_phone,
        u_je.name as assigned_je_name, u_je.email as assigned_je_email, u_je.phone as assigned_je_phone
      FROM infra_tickets t
      JOIN infra_users u_app ON t.applicant_id = u_app.id
      LEFT JOIN infra_users u_je ON t.assigned_je_id = u_je.id
      WHERE t.id = ?
    `, [ticket_id]);

    if (tickets.length === 0) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    const ticketData = tickets[0];

    // Fetch all attachments
    const [attachments] = await pool.query(
      'SELECT a.*, u.name as uploader_name, u.role as uploader_role FROM infra_attachments a JOIN infra_users u ON a.uploaded_by = u.id WHERE a.ticket_id = ? ORDER BY a.created_at ASC',
      [ticket_id]
    );
    ticketData.attachments = attachments;

    // Fetch all reports history
    const [reports] = await pool.query(
      'SELECT r.*, u.name as je_name FROM infra_reports r JOIN infra_users u ON r.je_id = u.id WHERE r.ticket_id = ? ORDER BY r.created_at DESC',
      [ticket_id]
    );
    ticketData.reports = reports;

    // Fetch master unredacted audit trail
    const [auditLogs] = await pool.query(
      `SELECT a.*, u.name as actor_name, u.email as actor_email, u.role as actor_role 
       FROM infra_audit_logs a 
       JOIN infra_users u ON a.user_id = u.id 
       WHERE a.ticket_id = ? 
       ORDER BY a.created_at ASC`,
      [ticket_id]
    );
    ticketData.audit_logs = auditLogs;
    ticketData.assignees = await loadAssignees(pool, ticketData, 'SYSADMIN');
    // What a delete would hide, for the confirmation dialog.
    const [[counts]] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM infra_reports WHERE ticket_id = ?) AS reports,
              (SELECT COUNT(*) FROM infra_attachments WHERE ticket_id = ?) AS files,
              (SELECT COUNT(*) FROM infra_ticket_messages WHERE ticket_id = ?) AS messages`,
      [ticket_id, ticket_id, ticket_id]);
    ticketData.counts = { reports: Number(counts.reports), files: Number(counts.files), messages: Number(counts.messages) };

    res.json({ success: true, ticket: ticketData });
  } catch (error) {
    return sendServerError(req, res, error, 'getTicketMasterDetails error');
  }
};

// 4. Admin Master Override: force the status and/or reassign the holder of any desk.
//    Body: { remarks, new_status?, reassign?: { desk, user_id } }
//    Legacy body { new_assigned_je_id } still means reassign JE.
const REASSIGN_DESKS = ['JE', 'AE', 'SE', 'DEAN', 'DIRECTOR'];
const OPEN_JE_STATUSES = ['ASSIGNED_TO_JE', 'RETURNED_TO_JE'];

const badRequest = (message, code = 'BAD_REQUEST') => new WorkflowError(message, { code, status: 400 });

// JE/AE work inside a (department, campus) scope. An override may go outside it; the audit line says so.
async function outsideScope(connection, user, ticket) {
  if (user.role !== 'JE' && user.role !== 'AE') return false;
  const [rows] = await connection.query(
    `SELECT 1 FROM infra_user_scopes s
      WHERE s.user_id = ? AND s.department = ? AND (? IS NULL OR s.campus IN (?, 'BOTH')) LIMIT 1`,
    [user.id, ticket.department, ticket.campus ?? null, ticket.campus ?? null]);
  return rows.length === 0;
}

export const overrideTicketStatus = async (req, res) => {
  const { ticket_id } = req.params;
  const new_status = req.body.new_status || req.body.status;
  const legacyJeId = req.body.new_assigned_je_id || req.body.assigned_to_user_id;
  const reassign = req.body.reassign
    ?? (legacyJeId ? { desk: 'JE', user_id: legacyJeId } : null);
  const remarks = req.body.remarks;
  const adminId = req.user.id;
  const adminName = req.user.name;

  if (!remarks || !remarks.trim()) {
    return res.status(400).json({ success: false, message: 'A reason is required.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query('SELECT * FROM infra_tickets WHERE id = ? FOR UPDATE', [ticket_id]);
    if (rows.length === 0) {
      throw new WorkflowError(`Ticket #${ticket_id} not found.`, { code: 'NOT_FOUND', status: 404 });
    }
    const current = rows[0];
    if (current.deleted_at) {
      throw new WorkflowError('This ticket is deleted. Restore it first.', { code: 'TICKET_DELETED', status: 409 });
    }
    let auditRemarks = `[SYSADMIN OVERRIDE by ${adminName}]: ${remarks.trim()}`;

    // ---- validate the request before touching anything --------------------------------
    if (new_status !== undefined && new_status !== null && new_status !== '' && !Object.values(STATUS).includes(new_status)) {
      throw badRequest(`Unknown status '${new_status}'.`, 'INVALID_STATUS');
    }
    const statusChanged = !!new_status && new_status !== current.status;
    const finalStatus = statusChanged ? new_status : current.status;

    let target = null;
    if (reassign) {
      const userId = Number.parseInt(reassign.user_id, 10);
      if (!REASSIGN_DESKS.includes(reassign.desk)) {
        throw badRequest(`desk must be one of ${REASSIGN_DESKS.join(', ')}.`, 'INVALID_DESK');
      }
      if (!Number.isInteger(userId) || userId <= 0) throw badRequest('user_id must be a positive integer.', 'INVALID_ASSIGNEE');
      const [users] = await connection.query(
        'SELECT id, name, email, role, is_active FROM infra_users WHERE id = ?', [userId]);
      const u = users[0];
      if (!u || !u.is_active || u.role !== reassign.desk) {
        throw badRequest(`User ${userId} is not an active ${reassign.desk}.`, 'INVALID_ASSIGNEE');
      }
      target = { desk: reassign.desk, user: u };
    }

    // ---- compute the new row ---------------------------------------------------------------
    const set = {};
    if (statusChanged) {
      set.status = finalStatus;
      set.status_changed_at = new Date();
      // A forced status leaves no change request open: otherwise the page and the
      // endpoint disagree on whether a reply is mandatory.
      if (current.open_change_request_id != null) {
        set.open_change_request_id = null;
        auditRemarks += ' | Open change request cleared';
      }
      auditRemarks += ` | Status changed from ${current.status} to ${finalStatus}`;
    }
    const next = { ...current, ...set };
    if (target) {
      const column = { JE: 'assigned_je_id', AE: 'assigned_ae_id', SE: 'assigned_se_id' }[target.desk];
      if (column) {
        set[column] = target.user.id;
        next[column] = target.user.id;
        if (target.desk === 'JE') set.assigned_at = new Date();
      }
      auditRemarks += ` | Reassigned ${target.desk} to ${target.user.name} (${target.user.email})`;
      if (await outsideScope(connection, target.user, current)) {
        auditRemarks += ` | Note: ${target.user.name} has no scope for ${current.department}/${current.campus ?? 'any campus'}`;
      }
    }

    // Who must act now. Reassigning the desk the ticket sits at hands it over; a forced
    // status recomputes the holder (pins are honoured); otherwise nothing changes.
    const deskNow = deskForStatus(finalStatus);
    let nextHolder = null;
    if (target && target.desk === deskNow) {
      nextHolder = target.user;
    } else if (statusChanged) {
      nextHolder = deskNow ? await resolveDeskOwner(connection, next, deskNow) : null;
      if (deskNow && !nextHolder) {
        throw new WorkflowError(`Nobody is available at the ${deskNow} desk for this ticket.`,
          { code: 'NO_DESK_OWNER', status: 409 });
      }
      if (nextHolder) {
        const pins = pinsFor(deskNow, nextHolder);
        if (pins.assignedAeId !== undefined) set.assigned_ae_id = pins.assignedAeId;
        if (pins.assignedSeId !== undefined) set.assigned_se_id = pins.assignedSeId;
      }
    }
    const holderChanged = (target && target.desk === deskNow) || statusChanged;
    if (holderChanged) set.current_desk_user_id = nextHolder ? nextHolder.id : null;

    // Forcing a ticket to "resolved" or "closed" must leave the same trail as the normal route, so the
    // confirmer, the 7-day clock and the closed time exist.
    let confirmer = null;
    if (statusChanged && finalStatus === STATUS.WORK_COMPLETED) {
      confirmer = await pickConfirmer(connection, next);
      Object.assign(set, {
        resolved_from_status: current.status, resolved_at: new Date(), resolved_by: adminId,
        resolution_kind: 'OVERRIDE', applicant_sent_back_at: null, current_desk_user_id: confirmer.id,
      });
    }
    if (statusChanged && finalStatus === STATUS.CLOSED) set.closed_at = new Date();

    // ---- write ------------------------------------------------------------------------------------
    const columns = Object.keys(set);
    if (columns.length > 0) {
      await connection.query(
        `UPDATE infra_tickets SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
        [...columns.map((c) => set[c]), ticket_id]);
    }

    await insertAudit(connection, {
      ticketId: Number(ticket_id), userId: adminId, action: target ? 'REASSIGNED' : 'OVERRIDE',
      remarks: auditRemarks,
      fromStatus: current.status, toStatus: finalStatus,
      fromDesk: deskForStatus(current.status), toDesk: target ? target.desk : deskNow,
      isSelfAction: isSelfAction(current, adminId),
    });

    // Restart the right reminder series for wherever the ticket now sits, and
    // tell the new holder / the applicant (stage only) -- same transaction.
    if (confirmer) {
      await notifyResolved(connection, {
        ticketId: Number(ticket_id), confirmer, kind: 'OVERRIDE',
        autoCloseOn: new Date(Date.now() + AUTO_CLOSE_DAYS * 24 * 3600 * 1000),
      });
    } else if (columns.length > 0) {
      await notifyAdminOverride(connection, {
        ticketId: ticket_id, fromStatus: current.status, previousJeId: current.assigned_je_id ?? null,
      });
    }

    await connection.commit();
    kickOutbox();

    res.json({
      success: true,
      status: finalStatus,
      current_desk_user_id: set.current_desk_user_id !== undefined ? set.current_desk_user_id : current.current_desk_user_id,
      message: 'Ticket updated.',
    });
  } catch (error) {
    await connection.rollback();
    if (error instanceof WorkflowError) {
      return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    return sendServerError(req, res, error, 'overrideTicketStatus error');
  } finally {
    connection.release();
  }
};

// Staff directory for the override form: active users of one desk, best match first.
export const getStaff = async (req, res) => {
  const { role, department, campus } = req.query;
  if (!REASSIGN_DESKS.includes(role)) {
    return res.status(400).json({ success: false, message: `role must be one of ${REASSIGN_DESKS.join(', ')}.` });
  }
  const load = role === 'JE'
    ? `(SELECT COUNT(*) FROM infra_tickets t WHERE t.assigned_je_id = u.id AND t.status IN (?) AND t.is_mock = FALSE AND t.deleted_at IS NULL)`
    : `(SELECT COUNT(*) FROM infra_tickets t WHERE t.current_desk_user_id = u.id AND t.status NOT IN ('CLOSED','DENIED') AND t.is_mock = FALSE AND t.deleted_at IS NULL)`;
  const loadParams = role === 'JE' ? [OPEN_JE_STATUSES] : [];
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.department, u.campus, ${load} AS open_tickets,
              EXISTS (SELECT 1 FROM infra_user_scopes s
                       WHERE s.user_id = u.id AND s.department = ? AND (? IS NULL OR s.campus IN (?, 'BOTH'))) AS scope_match,
              EXISTS (SELECT 1 FROM infra_user_availability a
                       WHERE a.user_id = u.id AND NOW() BETWEEN a.start_at AND a.end_at) AS on_leave
         FROM infra_users u
        WHERE u.role = ? AND u.is_active = TRUE
        ORDER BY scope_match DESC, on_leave ASC, open_tickets ASC, u.name ASC`,
      [...loadParams, department ?? null, campus ?? null, campus ?? null, role]
    );
    res.json({
      success: true,
      staff: rows.map((r) => ({
        id: r.id, name: r.name, email: r.email, department: r.department, campus: r.campus,
        open_tickets: Number(r.open_tickets), scope_match: !!r.scope_match && !!department, on_leave: !!r.on_leave,
      })),
    });
  } catch (error) {
    return sendServerError(req, res, error, 'getStaff error');
  }
};

// Dean and Director are single-holder desks: tell the Sysadmin when an edit leaves one of them not at exactly one real holder.
async function deskWarnings(roles) {
  const health = await checkSingleHolders(pool);
  return [...new Set(roles)].filter((r) => health[r] && !health[r].ok).map((r) => health[r].message);
}

// 5. User Account Management
export const getAllUsers = async (req, res) => {
  const { search, role, department } = req.query;

  let query = `
    SELECT id, firebase_uid, name, email, role, department, phone, is_active, created_at 
    FROM infra_users 
    WHERE 1=1
  `;
  const params = [];

  if (search) {
    query += ` AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)`;
    const term = `%${search}%`;
    params.push(term, term, term);
  }
  if (role && role !== 'ALL') {
    query += ` AND role = ?`;
    params.push(role);
  }
  if (department && department !== 'ALL') {
    query += ` AND department = ?`;
    params.push(department);
  }

  query += ` ORDER BY created_at DESC, name ASC`;

  try {
    const [users] = await pool.query(query, params);
    res.json({ success: true, users });
  } catch (error) {
    return sendServerError(req, res, error, 'getAllUsers error');
  }
};

// 6. Create New User
const ROLES = ['APPLICANT', 'JE', 'AE', 'SE', 'DEAN', 'DIRECTOR', 'SYSADMIN'];
const CAMPUSES = ['NORTH', 'SOUTH', 'BOTH'];
const DEPARTMENTS = ['Civil', 'Electrical', 'Horticulture', 'Administration', 'General'];
const SCOPED_ROLES = ['JE', 'AE', 'SE'];
const SINGLETON_ROLES = ['DEAN', 'DIRECTOR'];

// A1/A6/A7: routing reads user_scopes, so every save keeps them in step with
// the user row; `scopes` ([{department, campus}]) replaces the extra coverage
// (e.g. a Civil AE who also runs Horticulture). Then stale desk owners are healed.
async function syncStaffRouting(connection, userId, scopes) {
  const [[u]] = await connection.query(
    'SELECT id, role, department, campus, is_active FROM infra_users WHERE id = ?', [userId]);
  if (SCOPED_ROLES.includes(u.role)) {
    if (scopes) await connection.query('DELETE FROM infra_user_scopes WHERE user_id = ?', [userId]);
    const all = [...(u.campus ? [{ department: u.department, campus: u.campus }] : []), ...(scopes || [])];
    for (const sc of all) {
      await connection.query(
        'INSERT IGNORE INTO infra_user_scopes (user_id, department, campus) VALUES (?, ?, ?)',
        [userId, sc.department, sc.campus]);
    }
  }
  // Dean/Director are singleton desks: a real account replaces the dummy seed.
  if (SINGLETON_ROLES.includes(u.role) && u.is_active) {
    await connection.query('UPDATE infra_users SET is_active = FALSE WHERE role = ? AND id <> ?', [u.role, userId]);
  }
  await reconcileDeskOwners(connection);
}

// null = ok, else a 400 message
function validateStaffInput({ campus, scopes }) {
  if (campus != null && !CAMPUSES.includes(campus)) return 'campus must be NORTH, SOUTH or BOTH.';
  if (scopes != null) {
    if (!Array.isArray(scopes) || scopes.some((x) => !DEPARTMENTS.includes(x?.department) || !CAMPUSES.includes(x?.campus))) {
      return 'scopes must be a list of { department, campus } with valid values.';
    }
  }
  return null;
}

export const createUser = async (req, res) => {
  const name = req.body.name || req.body.full_name;
  const { email, role, department, phone, firebase_uid, scopes } = req.body;
  let { campus } = req.body;

  if (!name || !email || !role || !department) {
    return res.status(400).json({ success: false, message: 'Name, email, role, and department are required.' });
  }

  if (!ROLES.includes(role)) {
    return res.status(400).json({ success: false, message: `role must be one of ${ROLES.join(', ')}.` });
  }

  if (role === 'JE' && !['Civil', 'Electrical', 'Horticulture'].includes(department)) {
    return res.status(400).json({ 
      success: false, 
      message: 'Junior Engineers (JE) must belong to an engineering wing: Civil, Electrical, or Horticulture.' 
    });
  }

  if (role === 'SE' && !campus) campus = 'BOTH';
  if (['JE', 'AE'].includes(role) && !campus) {
    return res.status(400).json({ success: false, message: 'JE and AE accounts require a campus (NORTH, SOUTH or BOTH).' });
  }
  const bad = validateStaffInput({ campus, scopes });
  if (bad) return res.status(400).json({ success: false, message: bad });

  const generatedUid = firebase_uid || `campus_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO infra_users (firebase_uid, name, email, role, department, campus, phone, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [generatedUid, name.trim(), email.trim().toLowerCase(), role, department, campus || null, phone || null]
    );
    await syncStaffRouting(connection, result.insertId, scopes);
    await connection.commit();

    const [createdUsers] = await pool.query('SELECT * FROM infra_users WHERE id = ?', [result.insertId]);
    const warnings = await deskWarnings([role]);
    res.json({ success: true, user: createdUsers[0], ...(warnings.length ? { warnings } : {}) });
  } catch (error) {
    await connection.rollback();
    return sendServerError(req, res, error, 'createUser error');
  } finally {
    connection.release();
  }
};

// 7. Update User Details
export const updateUser = async (req, res) => {
  const { id } = req.params;
  const name = req.body.name !== undefined ? req.body.name : req.body.full_name;
  const { email, role, department, campus, phone, is_active, scopes } = req.body;

  const connection = await pool.getConnection();
  try {
    const bad = validateStaffInput({ campus, scopes });
    if (bad) return res.status(400).json({ success: false, message: bad });

    if (role !== undefined && !ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: `role must be one of ${ROLES.join(', ')}.` });
    }

    // Validate role & department consistency
    if (role === 'JE' && department && !['Civil', 'Electrical', 'Horticulture'].includes(department)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Junior Engineers (JE) must belong to an engineering wing: Civil, Electrical, or Horticulture.' 
      });
    }

    if (role === 'JE' && !department) {
      const [existing] = await pool.query('SELECT department FROM infra_users WHERE id = ?', [id]);
      if (existing.length > 0 && !['Civil', 'Electrical', 'Horticulture'].includes(existing[0].department)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Junior Engineers (JE) must belong to an engineering wing: Civil, Electrical, or Horticulture. Please specify a valid engineering department.' 
        });
      }
    }

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email.trim().toLowerCase()); }
    if (role !== undefined) { updates.push('role = ?'); params.push(role); }
    if (department !== undefined) { updates.push('department = ?'); params.push(department); }
    if (campus !== undefined) { updates.push('campus = ?'); params.push(campus || null); }
    if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(Boolean(is_active)); }

    if (updates.length === 0 && scopes === undefined) {
      return res.status(400).json({ success: false, message: 'No fields provided for update.' });
    }

    const [before] = await connection.query('SELECT role FROM infra_users WHERE id = ?', [id]);
    await connection.beginTransaction();
    if (updates.length > 0) {
      await connection.query(`UPDATE infra_users SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);
    }
    await syncStaffRouting(connection, id, scopes);
    await connection.commit();

    const [updatedUsers] = await pool.query('SELECT * FROM infra_users WHERE id = ?', [id]);
    const warnings = await deskWarnings([before[0]?.role, updatedUsers[0]?.role]);
    res.json({ success: true, user: updatedUsers[0], ...(warnings.length ? { warnings } : {}) });
  } catch (error) {
    await connection.rollback();
    return sendServerError(req, res, error, 'updateUser error');
  } finally {
    connection.release();
  }
};

// 8. Global Audit Trail Stream
export const getMasterAuditLogs = async (req, res) => {
  const { ticket_id, page = 1, limit = 50, self_only, include_mock } = req.query;
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  let query = `
    SELECT 
      a.*,
      t.title as ticket_title, t.department as ticket_department, t.status as ticket_status,
      u.name as actor_name, u.email as actor_email, u.role as actor_role
    FROM infra_audit_logs a
    JOIN infra_tickets t ON a.ticket_id = t.id
    JOIN infra_users u ON a.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (ticket_id) {
    query += ` AND a.ticket_id = ?`;
    params.push(ticket_id);
  }
  if (self_only === '1') query += ` AND a.is_self_action = TRUE`;
  if (include_mock !== '1') query += ` AND t.is_mock = FALSE`;

  query += ` ORDER BY a.created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit, 10), offset);

  try {
    const [logs] = await pool.query(query, params);
    res.json({ success: true, logs });
  } catch (error) {
    return sendServerError(req, res, error, 'getMasterAuditLogs error');
  }
};

// 9. Quick JE lookup for reassignment
export const getActiveJes = async (req, res) => {
  try {
    const [jes] = await pool.query(`
      SELECT u.id, u.name, u.email, u.department, COUNT(t.id) as active_tickets
      FROM infra_users u
      LEFT JOIN infra_tickets t ON u.id = t.assigned_je_id AND t.status NOT IN ('CLOSED', 'DENIED') AND t.is_mock = FALSE AND t.deleted_at IS NULL
      WHERE u.role = 'JE' AND u.is_active = TRUE
      GROUP BY u.id, u.name, u.email, u.department
      ORDER BY u.department, u.name
    `);
    res.json({ success: true, jes });
  } catch (error) {
    return sendServerError(req, res, error, 'getActiveJes error');
  }
};

// ---------------------------------------------------------------------------
// Sysadmin mock testing (plan2.md F5). Test tickets are raised by the Sysadmin,
// carry is_mock = TRUE, and sit at the Sysadmin's own desk at every stage. They
// are excluded from every report, list and mail path.
// ---------------------------------------------------------------------------
const MAX_TEST_ESTIMATE = 99_999_999.99;

const removeTicketFiles = (ticketId) => {
  if (!Number.isInteger(ticketId) || ticketId <= 0) return;
  fs.rmSync(path.join(uploadRoot(), 'tickets', String(ticketId)), { recursive: true, force: true });
};

// Locks a ticket and refuses anything that is not a test ticket.
async function lockMockTicket(connection, ticketId) {
  const [rows] = await connection.query('SELECT id, is_mock FROM infra_tickets WHERE id = ? FOR UPDATE', [ticketId]);
  if (rows.length === 0) throw new WorkflowError(`Ticket #${ticketId} not found.`, { code: 'NOT_FOUND', status: 404 });
  if (!rows[0].is_mock) {
    throw new WorkflowError('Only test tickets can be changed here.', { code: 'NOT_A_TEST_TICKET', status: 403 });
  }
}

async function insertStubReport(connection, ticketId, adminId, estimate) {
  await connection.query(
    `INSERT INTO infra_reports (ticket_id, je_id, version, nature_of_work, estimated_amount, remarks)
     VALUES (?, ?, 1, 'Test report', ?, NULL)`,
    [ticketId, adminId, estimate]);
}

const testAudit = (connection, ticketId, adminId, remarks) => insertAudit(connection, {
  ticketId, userId: adminId, action: 'CREATED', remarks, toStatus: STATUS.ASSIGNED_TO_JE, toDesk: 'JE',
});

export const listTestTickets = async (req, res) => {
  try {
    const [tickets] = await pool.query(
      `SELECT id, title, department, campus, status, created_at FROM infra_tickets WHERE is_mock = TRUE ORDER BY id DESC LIMIT 50`);
    res.json({ success: true, tickets });
  } catch (error) {
    return sendServerError(req, res, error, 'listTestTickets error');
  }
};

export const createTestTicket = async (req, res) => {
  const { department, campus } = req.body;
  const estimate = req.body.estimate;
  if (!['Civil', 'Electrical', 'Horticulture'].includes(department)) {
    return res.status(400).json({ success: false, message: 'Choose a department.' });
  }
  if (!['NORTH', 'SOUTH'].includes(campus)) {
    return res.status(400).json({ success: false, message: 'Choose a campus.' });
  }
  let amount = null;
  if (estimate !== undefined && estimate !== null && estimate !== '') {
    amount = Number(estimate);
    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_TEST_ESTIMATE) {
      return res.status(400).json({ success: false, message: 'Estimate is not a valid amount.' });
    }
  }
  const adminId = req.user.id;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO infra_tickets (applicant_id, assigned_je_id, current_desk_user_id, department, title, type, description,
         campus, landmark, priority, contact_phone, status, is_mock)
       VALUES (?, ?, ?, ?, 'Test ticket', 'recurring', 'Test ticket for workflow checks.', ?, 'Test', 'NORMAL',
         '0000000', 'ASSIGNED_TO_JE', TRUE)`,
      [adminId, adminId, adminId, department, campus]);
    const ticketId = result.insertId;
    if (amount !== null) await insertStubReport(connection, ticketId, adminId, amount);
    await testAudit(connection, ticketId, adminId, '[TEST] Test ticket created');
    await connection.commit();
    res.json({ success: true, ticket_id: ticketId });
  } catch (error) {
    await connection.rollback();
    return sendServerError(req, res, error, 'createTestTicket error');
  } finally {
    connection.release();
  }
};

// Back to the JE stage: keeps the ticket, clears everything the walk-through produced.
export const resetTestTicket = async (req, res) => {
  const ticketId = Number.parseInt(req.params.ticket_id, 10);
  const adminId = req.user.id;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await lockMockTicket(connection, ticketId);
    const [[stub]] = await connection.query(
      'SELECT estimated_amount FROM infra_reports WHERE ticket_id = ? AND version = 1 AND nature_of_work = ?', [ticketId, 'Test report']);
    // Order matters: reports point at messages, messages point at audit rows.
    for (const table of ['tenders', 'attachments', 'notifications', 'reports', 'ticket_messages', 'audit_logs'].map((t) => `infra_${t}`)) {
      await connection.query(`DELETE FROM ${table} WHERE ticket_id = ?`, [ticketId]);
    }
    await connection.query(
      `UPDATE infra_tickets SET status = 'ASSIGNED_TO_JE', assigned_je_id = ?, assigned_ae_id = NULL, assigned_se_id = NULL,
              current_desk_user_id = ?, open_change_request_id = NULL, status_changed_at = NOW() WHERE id = ?`,
      [adminId, adminId, ticketId]);
    if (stub) await insertStubReport(connection, ticketId, adminId, stub.estimated_amount);
    await testAudit(connection, ticketId, adminId, '[TEST] Test ticket reset');
    await connection.commit();
    removeTicketFiles(ticketId);
    res.json({ success: true, status: STATUS.ASSIGNED_TO_JE });
  } catch (error) {
    await connection.rollback();
    if (error instanceof WorkflowError) {
      return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    return sendServerError(req, res, error, 'resetTestTicket error');
  } finally {
    connection.release();
  }
};

export const deleteTestTicket = async (req, res) => {
  const ticketId = Number.parseInt(req.params.ticket_id, 10);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await lockMockTicket(connection, ticketId);
    await connection.query('DELETE FROM infra_tickets WHERE id = ? AND is_mock = TRUE', [ticketId]); // children cascade
    await connection.commit();
    removeTicketFiles(ticketId);
    res.json({ success: true });
  } catch (error) {
    await connection.rollback();
    if (error instanceof WorkflowError) {
      return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    return sendServerError(req, res, error, 'deleteTestTicket error');
  } finally {
    connection.release();
  }
};

// ---------------------------------------------------------------------------
// Delete (hide) and restore a REAL ticket (Master plan, section 9).
// Nothing is removed: reports, files, messages, timeline and tender stay attached to a ticket that only
// the Sysadmin can reach. Test tickets keep their own hard-delete endpoint.
// ---------------------------------------------------------------------------
export const deleteTicket = async (req, res) => {
  const ticketId = Number.parseInt(req.params.ticket_id, 10);
  const { confirm_ticket_id: typed, reason } = req.body ?? {};
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ success: false, code: 'BAD_TICKET_ID', message: 'ticket_id must be a positive integer.' });
  }
  const typedDigits = String(typed ?? '').replace(/\D/g, '');
  if (typedDigits === '' || Number(typedDigits) !== ticketId) {
    return res.status(400).json({ success: false, code: 'CONFIRMATION_MISMATCH', message: 'Type the ticket number to confirm.' });
  }
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (why.length < 10 || why.length > 1000) {
    return res.status(400).json({ success: false, code: 'REASON_INVALID', message: 'Give a reason of 10 to 1000 characters.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query('SELECT id, status, is_mock, deleted_at FROM infra_tickets WHERE id = ? FOR UPDATE', [ticketId]);
    const t = rows[0];
    if (!t) throw new WorkflowError(`Ticket #${ticketId} not found.`, { code: 'NOT_FOUND', status: 404 });
    if (t.is_mock) throw new WorkflowError('Test tickets are deleted from the test-ticket page.', { code: 'IS_TEST_TICKET', status: 409 });
    if (t.deleted_at) throw new WorkflowError('This ticket is already deleted.', { code: 'ALREADY_DELETED', status: 409 });

    await connection.query(
      'UPDATE infra_tickets SET deleted_at = NOW(), deleted_by = ?, delete_reason = ? WHERE id = ?', [req.user.id, why, ticketId]);
    // Nothing queued for this ticket may go out after it is hidden.
    await connection.query(
      "UPDATE infra_notifications SET status = 'CANCELLED', locked_until = NULL WHERE ticket_id = ? AND status = 'PENDING'", [ticketId]);
    await insertAudit(connection, {
      ticketId, userId: req.user.id, action: 'DELETED', remarks: `[SYSADMIN] Ticket hidden: ${why}`,
      fromStatus: t.status, toStatus: t.status, visibility: 'INTERNAL',
    });
    await connection.commit();
    res.json({ success: true, message: 'Ticket deleted. Only you can see it now.' });
  } catch (error) {
    await connection.rollback();
    if (error instanceof WorkflowError) {
      return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    return sendServerError(req, res, error, 'deleteTicket error');
  } finally {
    connection.release();
  }
};

export const restoreTicket = async (req, res) => {
  const ticketId = Number.parseInt(req.params.ticket_id, 10);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ success: false, code: 'BAD_TICKET_ID', message: 'ticket_id must be a positive integer.' });
  }
  const why = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (why.length < 1 || why.length > 1000) {
    return res.status(400).json({ success: false, code: 'REASON_INVALID', message: 'Give a reason (up to 1000 characters).' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query('SELECT id, status, deleted_at FROM infra_tickets WHERE id = ? FOR UPDATE', [ticketId]);
    const t = rows[0];
    if (!t) throw new WorkflowError(`Ticket #${ticketId} not found.`, { code: 'NOT_FOUND', status: 404 });
    if (!t.deleted_at) throw new WorkflowError('This ticket is not deleted.', { code: 'NOT_DELETED', status: 409 });

    // Reminders are not restarted. A ticket that was awaiting confirmation gets its 7 days again from now.
    await connection.query(
      `UPDATE infra_tickets SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL,
              resolved_at = CASE WHEN status = ? THEN NOW() ELSE resolved_at END
        WHERE id = ?`, [STATUS.WORK_COMPLETED, ticketId]);
    await insertAudit(connection, {
      ticketId, userId: req.user.id, action: 'RESTORED', remarks: `[SYSADMIN] Ticket restored: ${why}`,
      fromStatus: t.status, toStatus: t.status, visibility: 'INTERNAL',
    });
    await connection.commit();
    res.json({ success: true, message: 'Ticket restored.' });
  } catch (error) {
    await connection.rollback();
    if (error instanceof WorkflowError) {
      return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    return sendServerError(req, res, error, 'restoreTicket error');
  } finally {
    connection.release();
  }
};
