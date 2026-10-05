import fs from 'fs';
import path from 'path';
import pool from '../config/db.js';
import { TICKETS_DIR } from '../config/paths.js';
import {
  STATUS, WorkflowError, deskForStatus, MAX_AMOUNT, JE_STAGE, APPROVAL_STAGE, TENDER_STAGE, IN_WORK, POST_APPROVAL, TERMINAL,
} from '../config/workflow.js';
import { resolveDeskOwner, loadAssignees, reconcileDeskOwners } from '../models/deskModel.js';
import { insertAudit } from '../models/auditModel.js';
import { checkSingleHolders } from '../services/deskHealth.js';
import { pinsFor, isSelfAction } from './actionController.js';
import { notifyAdminOverride } from '../services/notifier.js';
import { previewDigestFor } from '../cron/weeklyDigest.js';
import { LATEST_REPORT, AWARDED_TENDER, EFFECTIVE_AMOUNT } from '../models/amountsModel.js';
import { buildAdminTicketFilter } from '../services/adminTicketFilter.js';
import {
  CHILD_TABLES, deletionPreview, buildSnapshot, deleteTicketCascade, trashTicketFiles,
} from '../services/ticketDeletion.js';
import { ticketRef } from '../services/emailTemplates.js';
import { z } from 'zod';
import { CSV_BOM, csvRow } from '../utils/csv.js';
import logger, { errorFields } from '../utils/logger.js';
import { kickOutbox } from '../cron/emailReminders.js';
import { sendServerError, sendWorkflowError } from '../utils/httpError.js';
import { worldClause, userWorldClause } from '../config/demo.js';
import { EDITABLE_LIMITS, readEditableLimits, saveLimits } from '../models/limitsModel.js';

// 1. System Overview Metrics
export const getAdminMetrics = async (req, res) => {
  const tw = worldClause(req.user, 't.');   // tickets world: real (not mock) or demo
  const tw0 = worldClause(req.user, '');
  const uw = userWorldClause(req.user, 'u.');
  const uw0 = userWorldClause(req.user, '');
  try {
    // Ticket status counts
    const [statusCounts] = await pool.query(`
      SELECT status, COUNT(*) as count FROM tickets WHERE ${tw0} GROUP BY status
    `);

    // Department counts
    const [deptCounts] = await pool.query(`
      SELECT department, COUNT(*) as count FROM tickets WHERE ${tw0} GROUP BY department
    `);

    // Work type counts
    const [typeCounts] = await pool.query(`
      SELECT type, COUNT(*) as count FROM tickets WHERE ${tw0} GROUP BY type
    `);

    // User counts by role
    const [userRoleCounts] = await pool.query(`
      SELECT role, COUNT(*) as count, SUM(CASE WHEN is_active = TRUE THEN 1 ELSE 0 END) as active_count 
      FROM users WHERE ${uw0} GROUP BY role
    `);

    // Financial estimates sum: all estimates vs approved
    const [allEstimates] = await pool.query(`
      SELECT COALESCE(SUM(r.estimated_amount), 0) as total_estimated_amount
      FROM reports r
      JOIN (SELECT ticket_id, MAX(id) as max_id FROM reports GROUP BY ticket_id) r_latest ON r.id = r_latest.max_id
      JOIN tickets t ON t.id = r.ticket_id
      WHERE ${tw}
    `);

    // Approved work: the award amount where there is one, else the JE's estimate (per ticket).
    const [financeSum] = await pool.query(`
      SELECT COALESCE(SUM(${EFFECTIVE_AMOUNT}), 0) as total_sanctioned_amount,
             COALESCE(SUM(aw.work_order_value), 0) as total_awarded_amount
      FROM tickets t
      LEFT JOIN ${LATEST_REPORT} r ON r.ticket_id = t.id
      LEFT JOIN ${AWARDED_TENDER} aw ON aw.ticket_id = t.id
      WHERE t.status IN (?)
        AND ${tw}
    `, [POST_APPROVAL]);

    // JE Workloads
    const [jeWorkloads] = await pool.query(`
      SELECT u.id, u.name as full_name, u.email, u.department, COUNT(t.id) as active_tickets_count
      FROM users u
      LEFT JOIN tickets t ON u.id = t.assigned_je_id AND t.status NOT IN (?) AND ${tw}
      WHERE u.role = 'JE' AND u.is_active = TRUE AND ${uw}
      GROUP BY u.id, u.name, u.email, u.department
      ORDER BY active_tickets_count DESC
    `, [TERMINAL]);

    // Total ticket count
    const [totalTicketsRow] = await pool.query(`SELECT COUNT(*) as total FROM tickets WHERE ${tw0}`);
    const [totalUsersRow] = await pool.query(`SELECT COUNT(*) as total FROM users WHERE ${uw0}`);

    // Calculate stage groups
    let pendingInspection = 0;
    let awaitingApproval = 0;
    let inTendering = 0;
    let closed = 0;

    for (const row of statusCounts) {
      const s = row.status || '';
      const c = Number(row.count) || 0;
      if (JE_STAGE.includes(s)) {
        pendingInspection += c;
      } else if (APPROVAL_STAGE.includes(s)) {
        awaitingApproval += c;
      } else if (TENDER_STAGE.includes(s) || IN_WORK.includes(s)) {
        inTendering += c;
      } else if (s === STATUS.CLOSED) {
        closed += c;
      }
    }

    const deskHealth = req.user?.is_demo ? undefined : await checkSingleHolders(pool);
    const [[selfRow]] = await pool.query(`
      SELECT COUNT(*) AS n FROM audit_logs a JOIN tickets t ON t.id = a.ticket_id
       WHERE a.is_self_action = TRUE AND ${tw} AND a.created_at >= NOW() - INTERVAL 30 DAY
    `);

    const byDepartment = deptCounts.map(d => ({ department: d.department, count: Number(d.count) }));
    const byStatus = statusCounts.map(s => ({ status: s.status, count: Number(s.count) }));

    res.json({
      success: true,
      metrics: {
        totalTickets: totalTicketsRow[0]?.total || 0,
        totalUsers: totalUsersRow[0]?.total || 0,
        usersCount: totalUsersRow[0]?.total || 0,
        totalSanctionedAmount: parseFloat(financeSum[0]?.total_sanctioned_amount || 0),
        totalApprovedAmount: parseFloat(financeSum[0]?.total_sanctioned_amount || 0),
        totalEstimatedAmount: parseFloat(allEstimates[0]?.total_estimated_amount || 0),
        totalAwardedAmount: parseFloat(financeSum[0]?.total_awarded_amount || 0),
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

// 2. Master Tickets Query. The same filter builder feeds the CSV export below.
const ADMIN_TICKET_FROM = `
    FROM tickets t
    JOIN users u_app ON t.applicant_id = u_app.id
    LEFT JOIN users u_je ON t.assigned_je_id = u_je.id
    LEFT JOIN users u_hold ON t.current_desk_user_id = u_hold.id
    LEFT JOIN ${LATEST_REPORT} r ON t.id = r.ticket_id
    LEFT JOIN ${AWARDED_TENDER} aw ON aw.ticket_id = t.id`;

const filterError = (res, errors) => res.status(400).json({
  success: false, code: 'INVALID_FILTER', message: 'A filter value is not valid.', errors });

export const getAllTickets = async (req, res) => {
  const filter = buildAdminTicketFilter(req.query, req.user);
  if (!filter.ok) return filterError(res, filter.errors);
  const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const offset = (pageNum - 1) * limitNum;

  try {
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS count ${ADMIN_TICKET_FROM} ${filter.whereSql}`, filter.params);
    const [tickets] = await pool.query(
      `SELECT
         t.id, t.title, t.department, t.campus, t.landmark, t.building, t.type, t.priority, t.description, t.location,
         t.status, t.created_at, t.is_mock,
         u_hold.name as current_holder_name,
         u_app.name as applicant_name, u_app.email as applicant_email, u_app.phone as applicant_phone,
         u_je.name as je_name, u_je.email as je_email,
         r.estimated_amount, r.nature_of_work, aw.work_order_value AS awarded_amount,
         ${EFFECTIVE_AMOUNT} AS effective_amount,
         (SELECT COUNT(*) FROM attachments a WHERE a.ticket_id = t.id) as attachment_count
       ${ADMIN_TICKET_FROM} ${filter.whereSql}
       ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`,
      [...filter.params, limitNum, offset]);

    res.json({ success: true, total: countRows[0].count, page: pageNum, limit: limitNum, tickets });
  } catch (error) {
    return sendServerError(req, res, error, 'getAllTickets error');
  }
};

// CSV of every ticket matching the same filters as the list (not just the visible page).
const EXPORT_PAGE = 1000;
const EXPORT_CAP = 50_000;
const EXPORT_HEADER = [
  'Ticket no', 'Created (IST)', 'Title', 'Department', 'Campus', 'Landmark', 'Type', 'Priority', 'Status',
  'Applicant name', 'Applicant e-mail', 'JE', 'Current holder', 'Estimate', 'Award amount', 'Last status change (IST)',
];

export const exportTickets = async (req, res) => {
  const filter = buildAdminTicketFilter(req.query, req.user);
  if (!filter.ok) return filterError(res, filter.errors);

  try {
    const [[{ count }]] = await pool.query(`SELECT COUNT(*) AS count ${ADMIN_TICKET_FROM} ${filter.whereSql}`, filter.params);
    const total = Number(count);
    if (total > EXPORT_CAP) {
      return res.status(400).json({
        success: false, code: 'TOO_MANY_ROWS',
        message: `${total} tickets match; the export is limited to ${EXPORT_CAP}. Narrow the filters.`,
      });
    }

    logger.info('ticket export', {
      requestId: req.id, userId: req.user.id, rows: total,
      filters: { ...filter.filters, search: filter.filters.search ? '(set)' : undefined },
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tickets_${istStamp(new Date())}.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.write(CSV_BOM + csvRow(EXPORT_HEADER));

    // Pages of 1,000, written as they are read.
    for (let offset = 0; offset < total; offset += EXPORT_PAGE) {
      const [rows] = await pool.query(
        `SELECT t.id, ${IST_STAMP('t.created_at')} AS created_ist, t.title, t.department, t.campus, t.landmark, t.location, t.type, t.priority, t.status,
                ${IST_STAMP('COALESCE(t.status_changed_at, t.created_at)')} AS last_change_ist,
                u_app.name AS applicant_name, u_app.email AS applicant_email,
                u_je.name AS je_name, u_hold.name AS holder_name,
                r.estimated_amount, aw.work_order_value AS awarded_amount
         ${ADMIN_TICKET_FROM} ${filter.whereSql}
         ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`,
        [...filter.params, EXPORT_PAGE, offset]);
      for (const t of rows) {
        res.write(csvRow([
          `TKT-${String(t.id).padStart(4, '0')}`, t.created_ist, t.title, t.department, t.campus,
          t.landmark ?? t.location, t.type, t.priority, t.status, t.applicant_name, t.applicant_email,
          t.je_name, t.holder_name, t.estimated_amount, t.awarded_amount, t.last_change_ist,
        ]));
      }
    }
    res.end();
  } catch (error) {
    // Headers may already be on the wire: end the file rather than send a JSON error into it.
    if (res.headersSent) { logger.error('ticket export failed mid-stream', { requestId: req.id, ...errorFields(error) }); return res.end(); }
    return sendServerError(req, res, error, 'exportTickets error');
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
      FROM tickets t
      JOIN users u_app ON t.applicant_id = u_app.id
      LEFT JOIN users u_je ON t.assigned_je_id = u_je.id
      WHERE t.id = ?
    `, [ticket_id]);

    if (tickets.length === 0) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    const ticketData = tickets[0];

    // Fetch all attachments
    const [attachments] = await pool.query(
      'SELECT a.*, u.name as uploader_name, u.role as uploader_role FROM attachments a JOIN users u ON a.uploaded_by = u.id WHERE a.ticket_id = ? ORDER BY a.created_at ASC',
      [ticket_id]
    );
    ticketData.attachments = attachments;

    // Fetch all reports history
    const [reports] = await pool.query(
      'SELECT r.*, u.name as je_name FROM reports r JOIN users u ON r.je_id = u.id WHERE r.ticket_id = ? ORDER BY r.created_at DESC',
      [ticket_id]
    );
    ticketData.reports = reports;

    // Fetch master unredacted audit trail
    const [auditLogs] = await pool.query(
      `SELECT a.*, u.name as actor_name, u.email as actor_email, u.role as actor_role 
       FROM audit_logs a 
       JOIN users u ON a.user_id = u.id 
       WHERE a.ticket_id = ? 
       ORDER BY a.created_at ASC`,
      [ticket_id]
    );
    ticketData.audit_logs = auditLogs;
    ticketData.assignees = await loadAssignees(pool, ticketData, 'SYSADMIN');

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

/** "20261005_1430" (IST) for a file name. */
const istStamp = (date) => {
  const d = new Date(new Date(date).getTime() + 5.5 * 60 * 60 * 1000).toISOString();
  return `${d.slice(0, 10).replace(/-/g, '')}_${d.slice(11, 16).replace(':', '')}`;
};

/** SQL: a TIMESTAMP shown as "2026-10-05 14:30" IST, whatever the server and session time zones are. */
const IST_STAMP = (column) =>
  `DATE_FORMAT(CONVERT_TZ(${column}, @@session.time_zone, '+05:30'), '%Y-%m-%d %H:%i')`;

const badRequest = (message, code = 'BAD_REQUEST') => new WorkflowError(message, { code, status: 400 });

// JE/AE work inside a (department, campus) scope. An override may go outside it; the audit line says so.
async function outsideScope(connection, user, ticket) {
  if (user.role !== 'JE' && user.role !== 'AE') return false;
  const [rows] = await connection.query(
    `SELECT 1 FROM user_scopes s
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

    const [rows] = await connection.query('SELECT * FROM tickets WHERE id = ? FOR UPDATE', [ticket_id]);
    if (rows.length === 0) {
      throw new WorkflowError(`Ticket #${ticket_id} not found.`, { code: 'NOT_FOUND', status: 404 });
    }
    const current = rows[0];
    let auditRemarks = `[SYSADMIN OVERRIDE by ${adminName}]: ${remarks.trim()}`;

    // ---- validate the request before touching anything --------------------------------
    if (new_status !== undefined && new_status !== null && new_status !== '' && !Object.values(STATUS).includes(new_status)) {
      throw badRequest(`Unknown status '${new_status}'.`, 'INVALID_STATUS');
    }
    const priority = req.body.priority;
    if (priority !== undefined && priority !== null && priority !== '' && !['LOW', 'NORMAL', 'URGENT'].includes(priority)) {
      throw badRequest(`priority must be one of LOW, NORMAL, URGENT.`, 'INVALID_PRIORITY');
    }
    const priorityChanged = !!priority && priority !== current.priority;
    const statusChanged = !!new_status && new_status !== current.status;
    const finalStatus = statusChanged ? new_status : current.status;

    // X7: a forced status must not skip a data gate. "Awarded" needs an award amount on file, or the
    // dashboards would count an award with no value; "Resolved" remembers where it came from.
    if (statusChanged && finalStatus === STATUS.WORK_IN_PROGRESS) {
      const [[award]] = await connection.query(
        "SELECT COUNT(*) AS n FROM tenders WHERE ticket_id = ? AND status = 'AWARDED' AND work_order_value > 0", [ticket_id]);
      if (Number(award.n) === 0) {
        throw new WorkflowError(
          'Cannot force Awarded: no award amount is on file. Record the award through the JE first.',
          { code: 'AWARD_REQUIRED', status: 409 });
      }
    }
    let target = null;
    if (reassign) {
      const userId = Number.parseInt(reassign.user_id, 10);
      if (!REASSIGN_DESKS.includes(reassign.desk)) {
        throw badRequest(`desk must be one of ${REASSIGN_DESKS.join(', ')}.`, 'INVALID_DESK');
      }
      if (!Number.isInteger(userId) || userId <= 0) throw badRequest('user_id must be a positive integer.', 'INVALID_ASSIGNEE');
      const [users] = await connection.query(
        'SELECT id, name, email, role, is_active FROM users WHERE id = ?', [userId]);
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
      if (finalStatus === STATUS.WORK_COMPLETED) {
        set.resolved_from_status = current.status;
        set.resolved_at = new Date();
      } else if (current.status === STATUS.WORK_COMPLETED) {
        set.resolved_from_status = null;
        set.resolved_at = null;
      }
      auditRemarks += ` | Status changed from ${current.status} to ${finalStatus}`;
    }
    if (priorityChanged) {
      set.priority = priority;
      auditRemarks += ` | Priority changed from ${current.priority} to ${priority}`;
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

    // ---- write ------------------------------------------------------------------------------------
    const columns = Object.keys(set);
    if (columns.length > 0) {
      await connection.query(
        `UPDATE tickets SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
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
    if (columns.length > 0) {
      await notifyAdminOverride(connection, {
        ticketId: ticket_id, fromStatus: current.status, oldJeId: current.assigned_je_id,
        newHolder: holderChanged ? nextHolder : null,
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
    if (error instanceof WorkflowError) return sendWorkflowError(req, res, error);
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
    ? `(SELECT COUNT(*) FROM tickets t WHERE t.assigned_je_id = u.id AND t.status IN (?) AND t.is_mock = FALSE)`
    : `(SELECT COUNT(*) FROM tickets t WHERE t.current_desk_user_id = u.id AND t.status NOT IN ('CLOSED','DENIED') AND t.is_mock = FALSE)`;
  const loadParams = role === 'JE' ? [OPEN_JE_STATUSES] : [];
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.department, u.campus, ${load} AS open_tickets,
              EXISTS (SELECT 1 FROM user_scopes s
                       WHERE s.user_id = u.id AND s.department = ? AND (? IS NULL OR s.campus IN (?, 'BOTH'))) AS scope_match,
              EXISTS (SELECT 1 FROM user_availability a
                       WHERE a.user_id = u.id AND NOW() BETWEEN a.start_at AND a.end_at) AS on_leave
         FROM users u
        WHERE u.role = ? AND u.is_active = TRUE AND u.is_demo = FALSE
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
    FROM users 
    WHERE ${userWorldClause(req.user, '')}
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
const CAMPUSES = ['NORTH', 'SOUTH', 'BOTH'];
const DEPARTMENTS = ['Civil', 'Electrical', 'Horticulture', 'Administration', 'General'];
const SCOPED_ROLES = ['JE', 'AE', 'SE'];
const SINGLETON_ROLES = ['DEAN', 'DIRECTOR'];

// A1/A6/A7: routing reads user_scopes, so every save keeps them in step with
// the user row; `scopes` ([{department, campus}]) replaces the extra coverage
// (e.g. a Civil AE who also runs Horticulture). Then stale desk owners are healed.
async function syncStaffRouting(connection, userId, scopes) {
  const [[u]] = await connection.query(
    'SELECT id, role, department, campus, is_active, is_demo FROM users WHERE id = ?', [userId]);
  if (SCOPED_ROLES.includes(u.role)) {
    if (scopes) await connection.query('DELETE FROM user_scopes WHERE user_id = ?', [userId]);
    const all = [...(u.campus ? [{ department: u.department, campus: u.campus }] : []), ...(scopes || [])];
    for (const sc of all) {
      await connection.query(
        'INSERT IGNORE INTO user_scopes (user_id, department, campus) VALUES (?, ?, ?)',
        [userId, sc.department, sc.campus]);
    }
  }
  // Dean/Director are singleton desks: a real account replaces the dummy seed.
  if (SINGLETON_ROLES.includes(u.role) && u.is_active && !u.is_demo) {
    await connection.query('UPDATE users SET is_active = FALSE WHERE role = ? AND id <> ? AND is_demo = FALSE', [u.role, userId]);
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
      `INSERT INTO users (firebase_uid, name, email, role, department, campus, phone, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [generatedUid, name.trim(), email.trim().toLowerCase(), role, department, campus || null, phone || null]
    );
    await syncStaffRouting(connection, result.insertId, scopes);
    await connection.commit();

    const [createdUsers] = await pool.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
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
    const [target] = await connection.query('SELECT is_demo FROM users WHERE id = ?', [id]);
    if (target[0]?.is_demo) {
      return res.status(403).json({ success: false, message: 'Demo accounts are managed by the server.' });
    }
    const bad = validateStaffInput({ campus, scopes });
    if (bad) return res.status(400).json({ success: false, message: bad });

    // Validate role & department consistency
    if (role === 'JE' && department && !['Civil', 'Electrical', 'Horticulture'].includes(department)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Junior Engineers (JE) must belong to an engineering wing: Civil, Electrical, or Horticulture.' 
      });
    }

    if (role === 'JE' && !department) {
      const [existing] = await pool.query('SELECT department FROM users WHERE id = ?', [id]);
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

    const [before] = await connection.query('SELECT role FROM users WHERE id = ?', [id]);
    await connection.beginTransaction();
    if (updates.length > 0) {
      await connection.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);
    }
    await syncStaffRouting(connection, id, scopes);
    await connection.commit();

    const [updatedUsers] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
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
    FROM audit_logs a
    JOIN tickets t ON a.ticket_id = t.id
    JOIN users u ON a.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (ticket_id) {
    query += ` AND a.ticket_id = ?`;
    params.push(ticket_id);
  }
  if (self_only === '1') query += ` AND a.is_self_action = TRUE`;
  if (req.user?.is_demo) query += ` AND t.is_demo = TRUE`;
  else if (include_mock !== '1') query += ` AND t.is_mock = FALSE`;

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
      FROM users u
      LEFT JOIN tickets t ON u.id = t.assigned_je_id AND t.status NOT IN ('CLOSED', 'DENIED') AND t.is_mock = FALSE
      WHERE u.role = 'JE' AND u.is_active = TRUE AND u.is_demo = FALSE
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
const MAX_TEST_ESTIMATE = MAX_AMOUNT;

const removeTicketFiles = (ticketId) => {
  if (!Number.isInteger(ticketId) || ticketId <= 0) return;
  fs.rmSync(path.join(TICKETS_DIR, String(ticketId)), { recursive: true, force: true });
};

// Locks a ticket and refuses anything that is not a test ticket.
async function lockMockTicket(connection, ticketId) {
  const [rows] = await connection.query('SELECT id, is_mock, is_demo FROM tickets WHERE id = ? FOR UPDATE', [ticketId]);
  if (rows.length === 0) throw new WorkflowError(`Ticket #${ticketId} not found.`, { code: 'NOT_FOUND', status: 404 });
  if (!rows[0].is_mock || rows[0].is_demo) { // demo tickets belong to the demo world, not to this page
    throw new WorkflowError('Only test tickets can be changed here.', { code: 'NOT_A_TEST_TICKET', status: 403 });
  }
}

async function insertStubReport(connection, ticketId, adminId, estimate) {
  await connection.query(
    `INSERT INTO reports (ticket_id, je_id, version, nature_of_work, estimated_amount, remarks)
     VALUES (?, ?, 1, 'Test report', ?, NULL)`,
    [ticketId, adminId, estimate]);
}

const testAudit = (connection, ticketId, adminId, remarks) => insertAudit(connection, {
  ticketId, userId: adminId, action: 'CREATED', remarks, toStatus: STATUS.ASSIGNED_TO_JE, toDesk: 'JE',
});

export const listTestTickets = async (req, res) => {
  try {
    const [tickets] = await pool.query(
      `SELECT id, title, department, campus, status, created_at FROM tickets WHERE is_mock = TRUE AND is_demo = FALSE ORDER BY id DESC LIMIT 50`);
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
      `INSERT INTO tickets (applicant_id, assigned_je_id, current_desk_user_id, department, title, type, description,
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
      'SELECT estimated_amount FROM reports WHERE ticket_id = ? AND version = 1 AND nature_of_work = ?', [ticketId, 'Test report']);
    // Order matters: reports point at messages, messages point at audit rows.
    for (const table of CHILD_TABLES) {
      await connection.query(`DELETE FROM ${table} WHERE ticket_id = ?`, [ticketId]);
    }
    await connection.query(
      `UPDATE tickets SET status = 'ASSIGNED_TO_JE', assigned_je_id = ?, assigned_ae_id = NULL, assigned_se_id = NULL,
              current_desk_user_id = ?, open_change_request_id = NULL, status_changed_at = NOW() WHERE id = ?`,
      [adminId, adminId, ticketId]);
    if (stub) await insertStubReport(connection, ticketId, adminId, stub.estimated_amount);
    await testAudit(connection, ticketId, adminId, '[TEST] Test ticket reset');
    await connection.commit();
    removeTicketFiles(ticketId);
    res.json({ success: true, status: STATUS.ASSIGNED_TO_JE });
  } catch (error) {
    await connection.rollback();
    if (error instanceof WorkflowError) return sendWorkflowError(req, res, error);
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
    await deleteTicketCascade(connection, ticketId); // children first, then the ticket (shared with the real delete)
    await connection.commit();
    removeTicketFiles(ticketId);
    res.json({ success: true });
  } catch (error) {
    await connection.rollback();
    if (error instanceof WorkflowError) return sendWorkflowError(req, res, error);
    return sendServerError(req, res, error, 'deleteTestTicket error');
  } finally {
    connection.release();
  }
};

// Sysadmin-only: the weekly digest text for one user, without sending or queueing anything.
export const previewDigest = async (req, res) => {
  const userId = Number.parseInt(req.query.user_id, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ success: false, code: 'BAD_USER_ID', message: 'user_id must be a positive integer.' });
  }
  try {
    const [rows] = await pool.query('SELECT id, name, email, role FROM users WHERE id = ?', [userId]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'User not found.' });
    const mail = await previewDigestFor(pool, rows[0]);
    res.json({ success: true, empty: mail === null, ...(mail ?? {}) });
  } catch (error) {
    return sendServerError(req, res, error, 'previewDigest error');
  }
};

// ---------------------------------------------------------------------------
// Real ticket deletion (Master-plan Phase 7). Permanent, with a tombstone.
// ---------------------------------------------------------------------------
const deleteSchema = z.object({
  reason: z.string().trim().min(10, 'Give a reason of at least 10 characters.').max(2000),
  confirm: z.string().trim(),
  force: z.preprocess((v) => v === true || v === 'true', z.boolean()).optional(),
});

/** What deleting a ticket would remove, for the confirmation dialog. */
export const getDeletionPreview = async (req, res) => {
  const ticketId = Number.parseInt(req.params.ticket_id, 10);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ success: false, code: 'BAD_TICKET_ID', message: 'ticket_id must be a positive integer.' });
  }
  try {
    const [rows] = await pool.query('SELECT id FROM tickets WHERE id = ?', [ticketId]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Ticket not found.' });
    res.json({ success: true, ticket_ref: ticketRef(ticketId), ...(await deletionPreview(pool, ticketId)) });
  } catch (error) {
    return sendServerError(req, res, error, 'getDeletionPreview error');
  }
};

export const deleteTicket = async (req, res) => {
  const ticketId = Number.parseInt(req.params.ticket_id, 10);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ success: false, code: 'BAD_TICKET_ID', message: 'ticket_id must be a positive integer.' });
  }
  // Validated before a connection is opened. The typed confirmation must be the ticket number.
  const parsed = deleteSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false, code: 'VALIDATION_ERROR', message: 'Invalid delete request.',
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const { reason, confirm, force } = parsed.data;
  if (confirm.toUpperCase() !== ticketRef(ticketId)) {
    return res.status(400).json({
      success: false, code: 'CONFIRMATION_MISMATCH', message: `Type ${ticketRef(ticketId)} to confirm.` });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query('SELECT * FROM tickets WHERE id = ? FOR UPDATE', [ticketId]);
    if (rows.length === 0) throw new WorkflowError(`Ticket #${ticketId} not found.`, { code: 'NOT_FOUND', status: 404 });

    const preview = await deletionPreview(connection, ticketId);
    if (preview.financial && force !== true) {
      throw new WorkflowError(
        `${ticketRef(ticketId)} has ${preview.has_bills ? 'bills' : 'an awarded tender'}. Send force: true to delete it anyway.`,
        { code: 'FINANCIAL_RECORDS', status: 409 });
    }

    const snapshot = await buildSnapshot(connection, rows[0]);
    await connection.query(
      `INSERT INTO deleted_tickets (ticket_id, deleted_by, deleted_by_name, reason, snapshot, file_count)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ticketId, req.user.id, req.user.name, reason, JSON.stringify(snapshot), snapshot.file_names.length]);

    await deleteTicketCascade(connection, ticketId);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (error instanceof WorkflowError) return sendWorkflowError(req, res, error);
    return sendServerError(req, res, error, 'deleteTicket error');
  } finally {
    connection.release();
  }

  logger.warn('ticket deleted', { requestId: req.id, adminId: req.user.id, ticketId, forced: force === true });
  const trashed = trashTicketFiles(ticketId);
  res.json({ success: true, ticket_id: ticketId, files_moved_to_trash: trashed !== null });
};

export const listDeletedTickets = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, ticket_id, deleted_by, deleted_by_name, deleted_at, reason, file_count,
              JSON_UNQUOTE(JSON_EXTRACT(snapshot, '$.ticket.title')) AS title,
              JSON_UNQUOTE(JSON_EXTRACT(snapshot, '$.ticket.status')) AS status,
              JSON_EXTRACT(snapshot, '$.estimate') AS estimate,
              JSON_EXTRACT(snapshot, '$.award_amount') AS award_amount
         FROM deleted_tickets ORDER BY id DESC LIMIT 200`);
    res.json({ success: true, deleted: rows });
  } catch (error) {
    return sendServerError(req, res, error, 'listDeletedTickets error');
  }
};

// Approval limits: the SE and Dean amounts that decide where an estimate is approved.
export const getLimits = async (req, res) => {
  try {
    res.json({ success: true, limits: await readEditableLimits(pool) });
  } catch (error) {
    return sendServerError(req, res, error, 'getLimits error');
  }
};

/** A positive amount, at most MAX_AMOUNT, at most two decimals. Numbers and numeric strings only. */
function limitAmount(key, raw) {
  const ok = (typeof raw === 'number') || (typeof raw === 'string' && raw.trim() !== '');
  const n = ok ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) {
    throw badRequest(`${key} must be a number greater than zero.`, 'LIMIT_INVALID');
  }
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
    throw badRequest(`${key} can have at most two decimals.`, 'LIMIT_INVALID');
  }
  return Math.round(n * 100) / 100;
}

export const updateLimits = async (req, res) => {
  const body = req.body ?? {};
  const connection = await pool.getConnection();
  try {
    const unknown = Object.keys(body).filter((k) => !EDITABLE_LIMITS.includes(k));
    if (unknown.length > 0) throw badRequest(`Only ${EDITABLE_LIMITS.join(' and ')} can be changed.`, 'LIMIT_UNKNOWN');
    const next = Object.fromEntries(EDITABLE_LIMITS.map((k) => [k, limitAmount(k, body[k])]));
    if (next.SE_APPROVE >= next.DEAN_APPROVE) {
      throw badRequest('The SE limit must be lower than the Dean limit.', 'LIMIT_ORDER');
    }

    await connection.beginTransaction();
    const before = await readEditableLimits(connection);
    await saveLimits(connection, next, req.user.id);
    await connection.commit();

    logger.warn('approval limits changed', {
      requestId: req.id, adminId: req.user.id,
      old: { SE_APPROVE: before.SE_APPROVE.amount, DEAN_APPROVE: before.DEAN_APPROVE.amount }, new: next,
    });
    res.json({ success: true, limits: await readEditableLimits(pool), message: 'Limits saved.' });
  } catch (error) {
    await connection.rollback();
    if (error instanceof WorkflowError) return sendWorkflowError(req, res, error);
    return sendServerError(req, res, error, 'updateLimits error');
  } finally {
    connection.release();
  }
};
