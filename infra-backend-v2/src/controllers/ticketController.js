import pool from '../config/db.js';
import { sendEmail } from '../utils/mailer.js';
import { resolveTransition, resolveTenderUpdate, WorkflowError, ROLE } from '../config/workflow.js';

export const createTicket = async (req, res) => {
  const applicant_id = req.user.id; 
  const { department, description, location, type = 'recurring' } = req.body;

  if (type === 'non-recurring' && req.user.role !== 'JE') {
    return res.status(403).json({ success: false, message: 'Only JEs can initiate non-recurring work.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [jes] = await connection.query(`
      SELECT u.id, u.email, COUNT(t.id) as active_tickets
      FROM users u
      LEFT JOIN tickets t ON u.id = t.assigned_je_id AND t.status NOT IN ('CLOSED', 'DENIED')
      WHERE u.role = 'JE' AND u.department = ?
      GROUP BY u.id
      ORDER BY active_tickets ASC
      LIMIT 1
    `, [department]);

    if (jes.length === 0) throw new Error(`No JE available for the ${department} department`);
    const assigned_je = jes[0];

    const [ticketResult] = await connection.query(
      `INSERT INTO tickets (applicant_id, assigned_je_id, department, type, description, location, status) 
       VALUES (?, ?, ?, ?, ?, ?, 'ASSIGNED_TO_JE')`,
      [applicant_id, assigned_je.id, department, type, description, location]
    );
    
    const ticket_id = ticketResult.insertId;

    // --- FIX: SAVE THE ATTACHMENTS TO THE DATABASE ---
    if (req.files && req.files.length > 0) {
      const attachmentQueries = req.files.map(file => {
        const fileUrl = `/uploads/${file.filename}`;
        return connection.query(
          'INSERT INTO attachments (ticket_id, file_url, uploaded_by) VALUES (?, ?, ?)',
          [ticket_id, fileUrl, applicant_id]
        );
      });
      await Promise.all(attachmentQueries);
    }
    // -------------------------------------------------

    await connection.commit();

    sendEmail(
      assigned_je.email, 
      'New Ticket Assigned', 
      `You have been assigned Ticket #${ticket_id}. Please log into the portal to review the location.`
    );

    res.json({ success: true, ticket_id, assigned_je_id: assigned_je.id });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ success: false, message: error.message });
  } finally {
    connection.release();
  }
};


// PAGINATION: Get Authority Queue
export const getQueue = async (req, res) => {
  const { role, department } = req.user;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;

  let query = '';
  let queryParams = [];

  if (role === 'DIRECTOR') {
    query = `SELECT * FROM tickets ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    queryParams = [limit, offset];
  } 
  // ... (You can expand AE/SE/DEAN queries here later)
  
  try {
    const [tickets] = await pool.query(query, queryParams);
    res.json({ success: true, page, limit, tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// JE SITE REPORT + ESTIMATE  (finding B4: this endpoint did not exist at all,
// so `reports` was never written and every budget ceiling compared against NULL)

// DECIMAL(10,2) = 10 digits total, 2 after the point. Above this MySQL either
// errors (strict mode) or silently rounds -- neither is acceptable for money.
const MAX_ESTIMATE = 99_999_999.99;

export async function applyReportSubmission(
  connection, { ticketId, jeId, role, natureOfWork, estimate, remarks }
) {
  const [rows] = await connection.query(
    `SELECT id, status FROM tickets WHERE id = ? AND assigned_je_id = ? FOR UPDATE`,
    [ticketId, jeId]
  );
  if (rows.length === 0) {
    throw new WorkflowError(
      `Ticket ${ticketId} not found, or it is not assigned to you.`,
      { code: 'NOT_FOUND', status: 404 }
    );
  }
  const currentStatus = rows[0].status;

  // Validate the free-text field here; the state machine validates the money.
  if (typeof natureOfWork !== 'string' || natureOfWork.trim().length === 0) {
    throw new WorkflowError('nature_of_work is required.',
      { code: 'NATURE_OF_WORK_REQUIRED', status: 400 });
  }
  if (natureOfWork.trim().length > 5000) {
    throw new WorkflowError('nature_of_work must be 5000 characters or fewer.',
      { code: 'NATURE_OF_WORK_TOO_LONG', status: 400 });
  }

  // Check "is it missing?" BEFORE coercing. Number(null) and Number('') are
  // both 0 -- not NaN -- so coercing first turned a missing estimate into a
  // legitimate-looking Rs.0 report, which then sailed under every ceiling.
  if (estimate === null || estimate === undefined || estimate === '') {
    throw new WorkflowError('estimated_amount is required.',
      { code: 'ESTIMATE_REQUIRED', status: 400 });
  }
  const amount = Number(estimate);
  // Distinct from "too large": telling someone their number is too big when
  // they actually sent "lots" is a misleading error.
  if (!Number.isFinite(amount)) {
    throw new WorkflowError('estimated_amount must be a number.',
      { code: 'ESTIMATE_INVALID', status: 400 });
  }
  if (amount > MAX_ESTIMATE) {
    throw new WorkflowError(
      `estimated_amount must be no greater than ${MAX_ESTIMATE} (DECIMAL(10,2)).`,
      { code: 'ESTIMATE_TOO_LARGE', status: 400 });
  }

  // The state machine owns the decision. Note we pass `role` in rather than
  // assuming JE: if someone wires this route to the wrong middleware, the
  // logic still refuses. Do not trust route-level RBAC on its own.
  const { status: nextStatus, logAction } = resolveTransition({
    currentStatus, role, action: 'SUBMIT_REPORT', estimate: amount,
  });

  // The reports table keeps EVERY version, so a returned-and-refiled ticket
  // preserves its history. /details reads the newest with ORDER BY ... LIMIT 1.
  const [reportResult] = await connection.query(
    `INSERT INTO reports (ticket_id, je_id, nature_of_work, estimated_amount)
     VALUES (?, ?, ?, ?)`,
    [ticketId, jeId, natureOfWork.trim(), amount]
  );

  const [result] = await connection.query(
    `UPDATE tickets SET status = ? WHERE id = ? AND status = ?`,
    [nextStatus, ticketId, currentStatus]
  );
  if (result.affectedRows !== 1) {
    throw new WorkflowError(
      'This ticket changed while you were working on it. Reload and try again.',
      { code: 'CONFLICT', status: 409 });
  }

  await connection.query(
    `INSERT INTO audit_logs (ticket_id, user_id, action, remarks) VALUES (?, ?, ?, ?)`,
    [ticketId, jeId, logAction, remarks || `Report filed, estimate INR ${amount}`]
  );

  return { nextStatus, reportId: reportResult.insertId, amount };
}

export const submitReport = async (req, res) => {
  const ticketId = Number.parseInt(req.params.ticket_id, 10);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({
      success: false, code: 'BAD_TICKET_ID', message: 'ticket_id must be a positive integer.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const out = await applyReportSubmission(connection, {
      ticketId,
      jeId: req.user.id,
      role: req.user.role,
      natureOfWork: req.body.nature_of_work,
      estimate: req.body.estimated_amount,
      remarks: req.body.remarks,
    });
    await connection.commit();
    res.json({
      success: true, status: out.nextStatus, report_id: out.reportId,
      message: `Report filed. Ticket forwarded to ${out.nextStatus.replace(/_/g, ' ')}.`,
    });
  } catch (error) {
    await connection.rollback();
    if (error instanceof WorkflowError) {
      return res.status(error.status).json({
        success: false, code: error.code, message: error.message });
    }
    console.error('submitReport failed:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  } finally {
    connection.release();
  }
};


// TENDERING & CLOSURE: Manual milestones updated by the JE
//
// Split in two on purpose:
//   applyTenderUpdate  = the logic. Takes a connection, throws WorkflowError.
//                        No req, no res -> testable with a mock connection.
//   updateTenderStatus = the HTTP wrapper. Parses, opens a transaction, maps
//                        errors to status codes. Nothing clever lives here.

export async function applyTenderUpdate(connection, { ticketId, jeId, milestone, remarks }) {
  // 1. Read the CURRENT status and lock the row. FOR UPDATE means a second
  //    concurrent request blocks here until this transaction commits, so it
  //    reads the NEW status rather than validating against a stale one.
  //    Ownership is enforced in the SELECT, not left to the UPDATE's WHERE.
  const [rows] = await connection.query(
    `SELECT id, status FROM tickets WHERE id = ? AND assigned_je_id = ? FOR UPDATE`,
    [ticketId, jeId]
  );

  // 2. The old code never checked this. It relied on the UPDATE's WHERE clause
  //    and then ignored affectedRows, so a JE posting to someone else's ticket
  //    got `{ success: true }` for a write that never happened.
  if (rows.length === 0) {
    throw new WorkflowError(
      `Ticket ${ticketId} not found, or it is not assigned to you.`,
      { code: 'NOT_FOUND', status: 404 }
    );
  }
  const currentStatus = rows[0].status;

  // 3. Let the state machine decide. THIS is the S1 fix: `milestone` is no
  //    longer written to the database on the caller's say-so.
  const { status: nextStatus, logAction } = resolveTenderUpdate({ currentStatus, milestone });

  // 4. Compare-and-swap. The WHERE repeats the exact status we validated
  //    against, so if anything changed it underneath us, affectedRows is 0.
  const [result] = await connection.query(
    `UPDATE tickets SET status = ? WHERE id = ? AND status = ?`,
    [nextStatus, ticketId, currentStatus]
  );
  if (result.affectedRows !== 1) {
    throw new WorkflowError(
      'This ticket changed while you were working on it. Reload and try again.',
      { code: 'CONFLICT', status: 409 }
    );
  }

  // 5. Every state change gets an audit row. The old code wrote none, which
  //    for a public-money workflow is a compliance gap, not just a nicety.
  await connection.query(
    `INSERT INTO audit_logs (ticket_id, user_id, action, remarks) VALUES (?, ?, ?, ?)`,
    [ticketId, jeId, logAction, remarks || `Milestone set to ${nextStatus}`]
  );

  return nextStatus;
}

export const updateTenderStatus = async (req, res) => {
  const ticketId = Number.parseInt(req.params.ticket_id, 10);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({
      success: false, code: 'BAD_TICKET_ID', message: 'ticket_id must be a positive integer.',
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const nextStatus = await applyTenderUpdate(connection, {
      ticketId,
      jeId: req.user.id,
      milestone: req.body.milestone,
      remarks: req.body.remarks,
    });
    await connection.commit();
    res.json({ success: true, status: nextStatus, message: `Ticket updated to ${nextStatus}` });
  } catch (error) {
    await connection.rollback();
    // Known rule violation -> the status code the workflow module chose.
    if (error instanceof WorkflowError) {
      return res.status(error.status).json({
        success: false, code: error.code, message: error.message,
      });
    }
    // Anything else is a real bug. Log it, and do NOT leak internals to the
    // client -- the old code returned error.message raw, which can expose SQL.
    console.error('updateTenderStatus failed:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  } finally {
    connection.release();
  }
};