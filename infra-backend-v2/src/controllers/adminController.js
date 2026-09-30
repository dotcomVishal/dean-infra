import pool from '../config/db.js';
import { STATUS, WorkflowError, deskForStatus } from '../config/workflow.js';
import { resolveDeskOwner, loadAssignees } from '../models/deskModel.js';
import { insertAudit } from '../models/auditModel.js';
import { checkSingleHolders } from '../services/deskHealth.js';
import { pinsFor, isSelfAction } from './actionController.js';
import { notifyAdminOverride } from '../services/notifier.js';
import { kickOutbox } from '../cron/emailReminders.js';
import { sendServerError } from '../utils/httpError.js';

// 1. System Overview Metrics
export const getAdminMetrics = async (req, res) => {
  try {
    // Ticket status counts
    const [statusCounts] = await pool.query(`
      SELECT status, COUNT(*) as count FROM tickets WHERE is_mock = FALSE GROUP BY status
    `);

    // Department counts
    const [deptCounts] = await pool.query(`
      SELECT department, COUNT(*) as count FROM tickets WHERE is_mock = FALSE GROUP BY department
    `);

    // Work type counts
    const [typeCounts] = await pool.query(`
      SELECT type, COUNT(*) as count FROM tickets WHERE is_mock = FALSE GROUP BY type
    `);

    // User counts by role
    const [userRoleCounts] = await pool.query(`
      SELECT role, COUNT(*) as count, SUM(CASE WHEN is_active = TRUE THEN 1 ELSE 0 END) as active_count 
      FROM users GROUP BY role
    `);

    // Financial estimates sum: all estimates vs approved
    const [allEstimates] = await pool.query(`
      SELECT COALESCE(SUM(r.estimated_amount), 0) as total_estimated_amount
      FROM reports r
      JOIN (SELECT ticket_id, MAX(id) as max_id FROM reports GROUP BY ticket_id) r_latest ON r.id = r_latest.max_id
      JOIN tickets t ON t.id = r.ticket_id
      WHERE t.is_mock = FALSE
    `);

    const [financeSum] = await pool.query(`
      SELECT COALESCE(SUM(r.estimated_amount), 0) as total_sanctioned_amount
      FROM reports r
      JOIN (SELECT ticket_id, MAX(id) as max_id FROM reports GROUP BY ticket_id) r_latest ON r.id = r_latest.max_id
      JOIN tickets t ON t.id = r.ticket_id
      WHERE t.status IN ('APPROVED_FOR_TENDERING', 'TENDER_PUBLISHED', 'WORK_IN_PROGRESS', 'CLOSED')
        AND t.is_mock = FALSE
    `);

    // JE Workloads
    const [jeWorkloads] = await pool.query(`
      SELECT u.id, u.name as full_name, u.email, u.department, COUNT(t.id) as active_tickets_count
      FROM users u
      LEFT JOIN tickets t ON u.id = t.assigned_je_id AND t.status NOT IN ('CLOSED', 'DENIED') AND t.is_mock = FALSE
      WHERE u.role = 'JE' AND u.is_active = TRUE
      GROUP BY u.id, u.name, u.email, u.department
      ORDER BY active_tickets_count DESC
    `);

    // Total ticket count
    const [totalTicketsRow] = await pool.query(`SELECT COUNT(*) as total FROM tickets WHERE is_mock = FALSE`);
    const [totalUsersRow] = await pool.query(`SELECT COUNT(*) as total FROM users`);

    // Calculate stage groups
    let pendingInspection = 0;
    let awaitingApproval = 0;
    let inTendering = 0;
    let closed = 0;

    for (const row of statusCounts) {
      const s = row.status || '';
      const c = Number(row.count) || 0;
      if (s === 'ASSIGNED_TO_JE' || s === 'RETURNED_TO_JE') {
        pendingInspection += c;
      } else if (s.startsWith('PENDING_')) {
        awaitingApproval += c;
      } else if (s === 'APPROVED_FOR_TENDERING' || s === 'TENDER_PUBLISHED' || s === 'WORK_IN_PROGRESS') {
        inTendering += c;
      } else if (s === 'CLOSED') {
        closed += c;
      }
    }

    const deskHealth = await checkSingleHolders(pool);
    const [[selfRow]] = await pool.query(`
      SELECT COUNT(*) AS n FROM audit_logs a JOIN tickets t ON t.id = a.ticket_id
       WHERE a.is_self_action = TRUE AND t.is_mock = FALSE AND a.created_at >= NOW() - INTERVAL 30 DAY
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

// 2. Master Tickets Query (with advanced filters & search)
export const getAllTickets = async (req, res) => {
  const { search, status, department, type, page = 1, limit = 25, include_mock } = req.query;
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 25;
  const offset = (pageNum - 1) * limitNum;

  let query = `
    SELECT 
      t.id, t.title, t.department, t.type, t.description, t.location, t.status, t.created_at, t.is_mock,
      u_hold.name as current_holder_name,
      u_app.name as applicant_name, u_app.email as applicant_email, u_app.phone as applicant_phone,
      u_je.name as je_name, u_je.email as je_email,
      r.estimated_amount, r.nature_of_work,
      (SELECT COUNT(*) FROM attachments a WHERE a.ticket_id = t.id) as attachment_count
    FROM tickets t
    JOIN users u_app ON t.applicant_id = u_app.id
    LEFT JOIN users u_je ON t.assigned_je_id = u_je.id
    LEFT JOIN users u_hold ON t.current_desk_user_id = u_hold.id
    LEFT JOIN (
      SELECT r1.* FROM reports r1
      JOIN (SELECT ticket_id, MAX(id) as max_id FROM reports GROUP BY ticket_id) r2
      ON r1.id = r2.max_id
    ) r ON t.id = r.ticket_id
    WHERE 1=1
  `;
  const params = [];

  if (include_mock !== '1') query += ' AND t.is_mock = FALSE';

  if (search) {
    query += ` AND (t.title LIKE ? OR t.description LIKE ? OR t.id = ? OR u_app.name LIKE ? OR t.location LIKE ?)`;
    const term = `%${search}%`;
    params.push(term, term, isNaN(search) ? 0 : parseInt(search, 10), term, term);
  }
  if (status && status !== 'ALL') {
    query += ` AND t.status = ?`;
    params.push(status);
  }
  if (department && department !== 'ALL') {
    query += ` AND t.department = ?`;
    params.push(department);
  }
  if (type && type !== 'ALL') {
    query += ` AND t.type = ?`;
    params.push(type);
  }

  // Count total matching
  const countQuery = `SELECT COUNT(*) as count FROM (${query}) as filtered_tickets`;

  query += ` ORDER BY t.created_at DESC LIMIT ? OFFSET ?`;
  params.push(limitNum, offset);

  try {
    const [countRows] = await pool.query(countQuery, params.slice(0, params.length - 2));
    const [tickets] = await pool.query(query, params);

    res.json({
      success: true,
      total: countRows[0].count,
      page: pageNum,
      limit: limitNum,
      tickets,
    });
  } catch (error) {
    return sendServerError(req, res, error, 'getAllTickets error');
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
        ticketId: ticket_id, fromStatus: current.status, newHolder: holderChanged ? nextHolder : null,
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
    FROM users 
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
export const createUser = async (req, res) => {
  const name = req.body.name || req.body.full_name;
  const { email, role, department, phone, firebase_uid } = req.body;

  if (!name || !email || !role || !department) {
    return res.status(400).json({ success: false, message: 'Name, email, role, and department are required.' });
  }

  if (role === 'JE' && !['Civil', 'Electrical', 'Horticulture'].includes(department)) {
    return res.status(400).json({ 
      success: false, 
      message: 'Junior Engineers (JE) must belong to an engineering wing: Civil, Electrical, or Horticulture.' 
    });
  }

  const generatedUid = firebase_uid || `campus_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  try {
    const [result] = await pool.query(
      `INSERT INTO users (firebase_uid, name, email, role, department, phone, is_active)
       VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
      [generatedUid, name.trim(), email.trim().toLowerCase(), role, department, phone || null]
    );

    const [createdUsers] = await pool.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
    const warnings = await deskWarnings([role]);
    res.json({ success: true, user: createdUsers[0], ...(warnings.length ? { warnings } : {}) });
  } catch (error) {
    return sendServerError(req, res, error, 'createUser error');
  }
};

// 7. Update User Details
export const updateUser = async (req, res) => {
  const { id } = req.params;
  const name = req.body.name !== undefined ? req.body.name : req.body.full_name;
  const { email, role, department, phone, is_active } = req.body;

  try {
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
    if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(Boolean(is_active)); }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields provided for update.' });
    }

    const [before] = await pool.query('SELECT role FROM users WHERE id = ?', [id]);
    params.push(id);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    const [updatedUsers] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
    const warnings = await deskWarnings([before[0]?.role, updatedUsers[0]?.role]);
    res.json({ success: true, user: updatedUsers[0], ...(warnings.length ? { warnings } : {}) });
  } catch (error) {
    return sendServerError(req, res, error, 'updateUser error');
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
      FROM users u
      LEFT JOIN tickets t ON u.id = t.assigned_je_id AND t.status NOT IN ('CLOSED', 'DENIED') AND t.is_mock = FALSE
      WHERE u.role = 'JE' AND u.is_active = TRUE
      GROUP BY u.id, u.name, u.email, u.department
      ORDER BY u.department, u.name
    `);
    res.json({ success: true, jes });
  } catch (error) {
    return sendServerError(req, res, error, 'getActiveJes error');
  }
};
