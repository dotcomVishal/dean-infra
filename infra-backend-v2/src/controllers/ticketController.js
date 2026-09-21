import pool from '../config/db.js';
import { sendEmail } from '../utils/mailer.js';
import { resolveTransition, resolveTenderUpdate, WorkflowError, ROLE } from '../config/workflow.js';
import { moveFile, cleanupTempFiles } from '../utils/fileManager.js';

export const createTicket = async (req, res) => {
  const applicant_id = req.user.id; 
  const { title, department, description, location, type = 'recurring' } = req.body;

  if (type === 'non-recurring' && req.user.role !== 'JE') {
    cleanupTempFiles(req.files);
    return res.status(403).json({ success: false, message: 'Only JEs can initiate non-recurring work.' });
  }

  const finalTitle = title?.trim() || (description ? description.trim().split('\n')[0].substring(0, 90) : 'Campus Infrastructure Request');

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let assigned_je_id;
    let assigned_je_email;
    let assigned_je_name = 'Engineer';

    // If JE is proposing work in their own department, assign to themselves; otherwise assign to least busy JE
    if (req.user.role === 'JE' && req.user.department === department) {
      assigned_je_id = req.user.id;
      assigned_je_email = req.user.email;
      assigned_je_name = req.user.name;
    } else {
      const [jes] = await connection.query(`
        SELECT u.id, u.name, u.email, COUNT(t.id) as active_tickets
        FROM users u
        LEFT JOIN tickets t ON u.id = t.assigned_je_id AND t.status NOT IN ('CLOSED', 'DENIED')
        WHERE u.role = 'JE' AND u.department = ?
        GROUP BY u.id
        ORDER BY active_tickets ASC
        LIMIT 1
      `, [department]);

      if (jes.length === 0) throw new Error(`No JE available for the ${department} department`);
      assigned_je_id = jes[0].id;
      assigned_je_email = jes[0].email;
      assigned_je_name = jes[0].name;
    }

    const [ticketResult] = await connection.query(
      `INSERT INTO tickets (applicant_id, assigned_je_id, department, title, type, description, location, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ASSIGNED_TO_JE')`,
      [applicant_id, assigned_je_id, department, finalTitle, type, description, location]
    );
    
    const ticket_id = ticketResult.insertId;

    if (req.files && req.files.length > 0) {
      const fileList = Array.isArray(req.files) ? req.files : Object.values(req.files).flat();
      const fileUrls = await Promise.all(
        fileList.map((file) => moveFile(file, ticket_id, 'applicant_evidence'))
      );

      const attachmentQueries = fileUrls.map((fileUrl) => connection.query(
        'INSERT INTO attachments (ticket_id, file_url, uploaded_by, document_category) VALUES (?, ?, ?, ?)',
        [ticket_id, fileUrl, applicant_id, 'APPLICANT_EVIDENCE']
      ));
      await Promise.all(attachmentQueries);
    }

    // Insert creation audit logs
    await connection.query(
      `INSERT INTO audit_logs (ticket_id, user_id, action, remarks) VALUES (?, ?, ?, ?)`,
      [ticket_id, applicant_id, 'CREATED', `Ticket raised: "${finalTitle}" (${type})`]
    );
    await connection.query(
      `INSERT INTO audit_logs (ticket_id, user_id, action, remarks) VALUES (?, ?, ?, ?)`,
      [ticket_id, assigned_je_id, 'ASSIGNED', `Auto-assigned to ${assigned_je_name} (${assigned_je_email})`]
    );

    await connection.commit();

    // Send rich, descriptive email notification to the assigned JE
    const portalUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const emailSubject = `[Deanery of Infrastructure] New Ticket #${ticket_id} Assigned: ${finalTitle}`;
    const emailText = `Dear ${assigned_je_name},

A new infrastructure maintenance/work ticket has been assigned to your desk for site inspection.

======================================================================
TICKET INFORMATION
======================================================================
• Ticket ID:      #TKT-${String(ticket_id).padStart(4, '0')}
• Title:          ${finalTitle}
• Department:     ${department} Engineering
• Work Type:      ${type === 'non-recurring' ? 'Non-Recurring Proposal' : 'Recurring Maintenance'}
• Reported By:    ${req.user.name} (${req.user.email}${req.user.phone ? `, Phone: ${req.user.phone}` : ''})
• Location / Map: ${location || 'Campus Landmark not specified'}
• Date & Time:    ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

======================================================================
ISSUE DESCRIPTION
======================================================================
${description}

======================================================================
ACTION REQUIRED
======================================================================
Please inspect the physical site, evaluate technical requirements, and file your inspection report with the estimated financial sanction on the Deanery portal:

🔗 Review & File Report: ${portalUrl}/je/ticket/${ticket_id}

Deanery of Infrastructure, IIT Mandi
This is an automated operational notification.`;

    sendEmail(assigned_je_email, emailSubject, emailText);

    res.json({ success: true, ticket_id, title: finalTitle, assigned_je_id });
  } catch (error) {
    await connection.rollback();
    cleanupTempFiles(req.files);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    connection.release();
  }
};


// PAGINATION: Get Authority Queue for AE, SE, DEAN, DIRECTOR
export const getQueue = async (req, res) => {
  const { role, department } = req.user;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const offset = (page - 1) * limit;

  let query = '';
  let queryParams = [];

  const baseSelect = `
    SELECT t.*, u.name as applicant_name, u.email as applicant_email, r.estimated_amount, r.nature_of_work
    FROM tickets t
    JOIN users u ON t.applicant_id = u.id
    LEFT JOIN (
      SELECT r1.* FROM reports r1
      JOIN (SELECT ticket_id, MAX(id) as max_id FROM reports GROUP BY ticket_id) r2
      ON r1.id = r2.max_id
    ) r ON t.id = r.ticket_id
  `;

  if (role === 'AE') {
    query = `${baseSelect} WHERE t.status = 'PENDING_AE_APPROVAL' AND t.department = ? ORDER BY t.created_at DESC LIMIT ? OFFSET ?`;
    queryParams = [department, limit, offset];
  } else if (role === 'SE') {
    query = `${baseSelect} WHERE t.status = 'PENDING_SE_APPROVAL' AND t.department = ? ORDER BY t.created_at DESC LIMIT ? OFFSET ?`;
    queryParams = [department, limit, offset];
  } else if (role === 'DEAN') {
    query = `${baseSelect} WHERE t.status = 'PENDING_DEAN_APPROVAL' ORDER BY t.created_at DESC LIMIT ? OFFSET ?`;
    queryParams = [limit, offset];
  } else if (role === 'DIRECTOR') {
    query = `${baseSelect} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`;
    queryParams = [limit, offset];
  } else {
    return res.status(403).json({ success: false, message: 'Unauthorized role for authority queue.' });
  }
  
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
    cleanupTempFiles(req.files);
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

    // Handle uploaded files (site_photos and estimate_docs)
    if (req.files) {
      let sitePhotos = [];
      let estimateDocs = [];

      if (Array.isArray(req.files)) {
        sitePhotos = req.files.filter(f => f.fieldname === 'site_photos');
        estimateDocs = req.files.filter(f => f.fieldname === 'estimate_docs');
      } else if (typeof req.files === 'object') {
        sitePhotos = req.files.site_photos || [];
        estimateDocs = req.files.estimate_docs || [];
      }

      for (const photo of sitePhotos) {
        const fileUrl = await moveFile(photo, ticketId, 'je_reports/site_photos');
        await connection.query(
          'INSERT INTO attachments (ticket_id, file_url, uploaded_by, document_category) VALUES (?, ?, ?, ?)',
          [ticketId, fileUrl, req.user.id, 'JE_SITE_PHOTO']
        );
      }

      for (const doc of estimateDocs) {
        const fileUrl = await moveFile(doc, ticketId, 'je_reports/estimate_docs');
        await connection.query(
          'INSERT INTO attachments (ticket_id, file_url, uploaded_by, document_category) VALUES (?, ?, ?, ?)',
          [ticketId, fileUrl, req.user.id, 'JE_ESTIMATE_DOC']
        );
      }
    }

    await connection.commit();
    res.json({
      success: true, status: out.nextStatus, report_id: out.reportId,
      message: `Report filed. Ticket forwarded to ${out.nextStatus.replace(/_/g, ' ')}.`,
    });
  } catch (error) {
    await connection.rollback();
    cleanupTempFiles(req.files);
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

// REVIEW TICKET: Zero-trust review for AE, SE, DEAN, DIRECTOR
export const reviewTicket = async (req, res) => {
  const ticketId = Number.parseInt(req.params.ticket_id, 10);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({
      success: false, code: 'BAD_TICKET_ID', message: 'ticket_id must be a positive integer.',
    });
  }

  const { action, remarks } = req.body;
  const { id: userId, role } = req.user; // Zero trust: identity verified from token & DB

  if (!action || !['APPROVE', 'RETURN', 'DENY'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Valid action (APPROVE, RETURN, DENY) is required.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT id, status FROM tickets WHERE id = ? FOR UPDATE`,
      [ticketId]
    );
    if (rows.length === 0) {
      throw new WorkflowError(`Ticket ${ticketId} not found.`, { code: 'NOT_FOUND', status: 404 });
    }

    const currentStatus = rows[0].status;

    // Fetch latest estimate from reports
    const [reports] = await connection.query(
      `SELECT estimated_amount FROM reports WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1`,
      [ticketId]
    );
    const estimate = reports.length > 0 ? parseFloat(reports[0].estimated_amount) : null;

    const { status: nextStatus, logAction } = resolveTransition({
      currentStatus,
      role,
      action,
      estimate,
    });

    const [result] = await connection.query(
      `UPDATE tickets SET status = ? WHERE id = ? AND status = ?`,
      [nextStatus, ticketId, currentStatus]
    );
    if (result.affectedRows !== 1) {
      throw new WorkflowError('This ticket changed while you were reviewing it. Reload and try again.', { code: 'CONFLICT', status: 409 });
    }

    await connection.query(
      `INSERT INTO audit_logs (ticket_id, user_id, action, remarks) VALUES (?, ?, ?, ?)`,
      [ticketId, userId, logAction, remarks || `${action} by ${role}`]
    );

    await connection.commit();
    res.json({ success: true, status: nextStatus, message: `Ticket updated to ${nextStatus}` });
  } catch (error) {
    await connection.rollback();
    if (error instanceof WorkflowError) {
      return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    console.error('reviewTicket failed:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  } finally {
    connection.release();
  }
};