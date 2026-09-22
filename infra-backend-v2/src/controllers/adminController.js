import pool from '../config/db.js';
import { sendEmail } from '../utils/mailer.js';

// 1. System Overview Metrics
export const getAdminMetrics = async (req, res) => {
  try {
    // Ticket status counts
    const [statusCounts] = await pool.query(`
      SELECT status, COUNT(*) as count FROM tickets GROUP BY status
    `);

    // Department counts
    const [deptCounts] = await pool.query(`
      SELECT department, COUNT(*) as count FROM tickets GROUP BY department
    `);

    // Work type counts
    const [typeCounts] = await pool.query(`
      SELECT type, COUNT(*) as count FROM tickets GROUP BY type
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
    `);

    const [financeSum] = await pool.query(`
      SELECT COALESCE(SUM(r.estimated_amount), 0) as total_sanctioned_amount
      FROM reports r
      JOIN (SELECT ticket_id, MAX(id) as max_id FROM reports GROUP BY ticket_id) r_latest ON r.id = r_latest.max_id
      JOIN tickets t ON t.id = r.ticket_id
      WHERE t.status IN ('APPROVED_FOR_TENDERING', 'TENDER_PUBLISHED', 'WORK_IN_PROGRESS', 'CLOSED')
    `);

    // JE Workloads
    const [jeWorkloads] = await pool.query(`
      SELECT u.id, u.name as full_name, u.email, u.department, COUNT(t.id) as active_tickets_count
      FROM users u
      LEFT JOIN tickets t ON u.id = t.assigned_je_id AND t.status NOT IN ('CLOSED', 'DENIED')
      WHERE u.role = 'JE' AND u.is_active = TRUE
      GROUP BY u.id, u.name, u.email, u.department
      ORDER BY active_tickets_count DESC
    `);

    // Total ticket count
    const [totalTicketsRow] = await pool.query(`SELECT COUNT(*) as total FROM tickets`);
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
      },
    });
  } catch (error) {
    console.error('getAdminMetrics error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. Master Tickets Query (with advanced filters & search)
export const getAllTickets = async (req, res) => {
  const { search, status, department, type, page = 1, limit = 25 } = req.query;
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 25;
  const offset = (pageNum - 1) * limitNum;

  let query = `
    SELECT 
      t.id, t.title, t.department, t.type, t.description, t.location, t.status, t.created_at,
      u_app.name as applicant_name, u_app.email as applicant_email, u_app.phone as applicant_phone,
      u_je.name as je_name, u_je.email as je_email,
      r.estimated_amount, r.nature_of_work,
      (SELECT COUNT(*) FROM attachments a WHERE a.ticket_id = t.id) as attachment_count
    FROM tickets t
    JOIN users u_app ON t.applicant_id = u_app.id
    LEFT JOIN users u_je ON t.assigned_je_id = u_je.id
    LEFT JOIN (
      SELECT r1.* FROM reports r1
      JOIN (SELECT ticket_id, MAX(id) as max_id FROM reports GROUP BY ticket_id) r2
      ON r1.id = r2.max_id
    ) r ON t.id = r.ticket_id
    WHERE 1=1
  `;
  const params = [];

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
    console.error('getAllTickets error:', error);
    res.status(500).json({ success: false, message: error.message });
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

    res.json({ success: true, ticket: ticketData });
  } catch (error) {
    console.error('getTicketMasterDetails error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. Admin Master Override: Force change status and/or reassign JE
export const overrideTicketStatus = async (req, res) => {
  const { ticket_id } = req.params;
  const new_status = req.body.new_status || req.body.status;
  const new_assigned_je_id = req.body.new_assigned_je_id || req.body.assigned_to_user_id;
  const remarks = req.body.remarks;
  const adminId = req.user.id;
  const adminName = req.user.name;

  if (!remarks || !remarks.trim()) {
    return res.status(400).json({ success: false, message: 'Administrative reason / remarks are strictly required for an override.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      'SELECT id, status, title, assigned_je_id, department FROM tickets WHERE id = ? FOR UPDATE',
      [ticket_id]
    );
    if (rows.length === 0) {
      throw new Error(`Ticket #${ticket_id} not found.`);
    }

    const currentTicket = rows[0];
    const updates = [];
    const updateParams = [];
    let auditRemarks = `[SYSADMIN OVERRIDE by ${adminName}]: ${remarks.trim()}`;

    // Handle status change
    let finalStatus = currentTicket.status;
    if (new_status && new_status !== currentTicket.status) {
      updates.push('status = ?');
      updateParams.push(new_status);
      finalStatus = new_status;
      auditRemarks += ` | Status changed from ${currentTicket.status} to ${new_status}`;
    }

    // Handle JE reassignment
    let reassignedJeEmail = null;
    if (new_assigned_je_id && parseInt(new_assigned_je_id, 10) !== currentTicket.assigned_je_id) {
      const [jeUser] = await connection.query(
        'SELECT id, name, email FROM users WHERE id = ? AND role = "JE"',
        [new_assigned_je_id]
      );
      if (jeUser.length === 0) {
        throw new Error('Target user is not a valid Junior Engineer.');
      }
      updates.push('assigned_je_id = ?');
      updateParams.push(new_assigned_je_id);
      reassignedJeEmail = jeUser[0].email;
      auditRemarks += ` | Reassigned to JE ${jeUser[0].name} (${jeUser[0].email})`;
    }

    if (updates.length > 0) {
      updateParams.push(ticket_id);
      await connection.query(
        `UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`,
        updateParams
      );
    }

    // Record immutable audit log
    await connection.query(
      'INSERT INTO audit_logs (ticket_id, user_id, action, remarks) VALUES (?, ?, ?, ?)',
      [ticket_id, adminId, 'APPROVED', auditRemarks]
    );

    await connection.commit();

    // If reassigned, notify the new JE
    if (reassignedJeEmail) {
      const portalUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      sendEmail(
        reassignedJeEmail,
        `[Deanery Admin Reassignment] Ticket #${ticket_id}: ${currentTicket.title}`,
        `Dear Engineer,\n\nTicket #${ticket_id} ("${currentTicket.title}") has been administratively assigned to your desk by System Administration.\n\nReason: ${remarks}\n\nView Ticket: ${portalUrl}/je/ticket/${ticket_id}\n\nDeanery of Infrastructure, IIT Mandi`
      );
    }

    res.json({
      success: true,
      status: finalStatus,
      message: 'Ticket administratively updated and audit record logged.',
    });
  } catch (error) {
    await connection.rollback();
    console.error('overrideTicketStatus error:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    connection.release();
  }
};

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
    console.error('getAllUsers error:', error);
    res.status(500).json({ success: false, message: error.message });
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
    res.json({ success: true, user: createdUsers[0] });
  } catch (error) {
    console.error('createUser error:', error);
    res.status(500).json({ success: false, message: error.message });
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

    params.push(id);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    const [updatedUsers] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
    res.json({ success: true, user: updatedUsers[0] });
  } catch (error) {
    console.error('updateUser error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 8. Global Audit Trail Stream
export const getMasterAuditLogs = async (req, res) => {
  const { ticket_id, page = 1, limit = 50 } = req.query;
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

  query += ` ORDER BY a.created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit, 10), offset);

  try {
    const [logs] = await pool.query(query, params);
    res.json({ success: true, logs });
  } catch (error) {
    console.error('getMasterAuditLogs error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 9. Quick JE lookup for reassignment
export const getActiveJes = async (req, res) => {
  try {
    const [jes] = await pool.query(`
      SELECT u.id, u.name, u.email, u.department, COUNT(t.id) as active_tickets
      FROM users u
      LEFT JOIN tickets t ON u.id = t.assigned_je_id AND t.status NOT IN ('CLOSED', 'DENIED')
      WHERE u.role = 'JE' AND u.is_active = TRUE
      GROUP BY u.id, u.name, u.email, u.department
      ORDER BY u.department, u.name
    `);
    res.json({ success: true, jes });
  } catch (error) {
    console.error('getActiveJes error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
