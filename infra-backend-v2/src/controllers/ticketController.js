import pool from '../config/db.js';
import { sendEmail } from '../utils/mailer.js';
import { resolveTransition, resolveTenderUpdate, WorkflowError, ROLE } from '../config/workflow.js';
import { moveFile, cleanupTempFiles } from '../utils/fileManager.js';
import { createTicketSchema, formatZodIssues } from '../validation/ticketValidation.js';
import { assignTicket } from '../services/assignment.js';

// D2: no runtime DDL. Schema is owned by migrations only -- ALTER TABLE inside
// a request transaction used to cause an implicit MySQL commit, silently
// committing a half-finished transaction that the later rollback could not undo.
export async function safeInsertAttachment(conn, ticketId, fileUrl, userId, category = 'APPLICANT_EVIDENCE') {
  await conn.query(
    'INSERT INTO attachments (ticket_id, file_url, uploaded_by, document_category) VALUES (?, ?, ?, ?)',
    [ticketId, fileUrl, userId, category]
  );
}

export const createTicket = async (req, res) => {
  const applicant_id = req.user.id;

  // Zod validation runs BEFORE any database transaction begins (plan.md §4
  // Phase 3 item 4) -- an invalid raise-ticket submission never even opens a
  // connection, let alone writes a row.
  const parsed = createTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    cleanupTempFiles(req.files);
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Invalid ticket data.',
      errors: formatZodIssues(parsed.error),
    });
  }
  const {
    title, department, description, type,
    campus, building, landmark, lat, lng, category, priority, contact_phone,
  } = parsed.data;

  if (type === 'non-recurring' && req.user.role !== 'JE') {
    cleanupTempFiles(req.files);
    return res.status(403).json({ success: false, message: 'Only JEs can initiate non-recurring work.' });
  }

  const finalTitle = title || description.split('\n')[0].substring(0, 90) || 'Campus Infrastructure Request';
  // Kept for backward compatibility with every existing reader of
  // tickets.location (queues, ticket details, emails); campus/building/
  // landmark/lat/lng also land in their own columns below.
  const locationLabel = [building, landmark].filter(Boolean).join(', ');

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let assignment;
    // If a JE is proposing work in their own department, they inspect it
    // themselves -- this is a distinct, pre-existing feature (JE-initiated
    // non-recurring proposals), not part of the fair-assignment pool.
    // Every other ticket goes through the fair auto-assignment engine.
    if (req.user.role === 'JE' && req.user.department === department) {
      assignment = {
        status: 'ASSIGNED_TO_JE',
        assignedJeId: req.user.id,
        currentDeskUserId: req.user.id,
        deskUser: { id: req.user.id, name: req.user.name, email: req.user.email },
      };
    } else {
      assignment = await assignTicket(connection, { department, campus });
    }

    // D2: no runtime DDL -- schema is owned by migrations only.
    const [ticketResult] = await connection.query(
      `INSERT INTO tickets (
         applicant_id, assigned_je_id, department, title, type, description, location,
         campus, building, landmark, lat, lng, category, priority, contact_phone,
         current_desk_user_id, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        applicant_id, assignment.assignedJeId, department, finalTitle, type, description, locationLabel,
        campus, building ?? null, landmark, lat ?? null, lng ?? null, category, priority, contact_phone,
        assignment.currentDeskUserId, assignment.status,
      ]
    );

    const ticket_id = ticketResult.insertId;

    if (req.files && req.files.length > 0) {
      const fileList = Array.isArray(req.files) ? req.files : Object.values(req.files).flat();
      const fileUrls = await Promise.all(
        fileList.map((file) => moveFile(file, ticket_id, 'applicant_evidence'))
      );

      for (const fileUrl of fileUrls) {
        await safeInsertAttachment(connection, ticket_id, fileUrl, applicant_id, 'APPLICANT_EVIDENCE');
      }
    }

    // Insert creation audit logs
    await connection.query(
      `INSERT INTO audit_logs (ticket_id, user_id, action, remarks) VALUES (?, ?, ?, ?)`,
      [ticket_id, applicant_id, 'CREATED', `Ticket raised: "${finalTitle}" (${type}, ${campus} campus)`]
    );
    await connection.query(
      `INSERT INTO audit_logs (ticket_id, user_id, action, remarks) VALUES (?, ?, ?, ?)`,
      [
        ticket_id, assignment.currentDeskUserId, 'ASSIGNED',
        assignment.status === 'ASSIGNED_TO_JE'
          ? `Auto-assigned to ${assignment.deskUser.name} (${assignment.deskUser.email})`
          : `UNASSIGNED: no available JE for ${department}/${campus} (pool exhausted or all on leave). ` +
            `Routed to AE ${assignment.deskUser.name} (${assignment.deskUser.email}) for manual assignment.`,
      ]
    );

    await connection.commit();

    // Notify the desk that now owns the ticket -- the assigned JE, or the AE
    // if it's queued UNASSIGNED.
    const portalUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const reporterLine = `${req.user.name} (${req.user.email}${req.user.phone ? `, Phone: ${req.user.phone}` : ''})`;
    const locationBlock = `${campus} campus${building ? `, ${building}` : ''} — ${landmark}`;

    if (assignment.status === 'ASSIGNED_TO_JE') {
      const emailSubject = `[Deanery of Infrastructure] New Ticket #${ticket_id} Assigned: ${finalTitle}`;
      const emailText = `Dear ${assignment.deskUser.name},

A new infrastructure maintenance/work ticket has been assigned to your desk for site inspection.

======================================================================
TICKET INFORMATION
======================================================================
• Ticket ID:      #TKT-${String(ticket_id).padStart(4, '0')}
• Title:          ${finalTitle}
• Department:     ${department} Engineering
• Category:       ${category}
• Priority:       ${priority}
• Work Type:      ${type === 'non-recurring' ? 'Non-Recurring Proposal' : 'Recurring Maintenance'}
• Reported By:    ${reporterLine}
• Contact Phone:  ${contact_phone}
• Location:       ${locationBlock}
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
      sendEmail(assignment.deskUser.email, emailSubject, emailText);
    } else {
      const emailSubject = `[Deanery of Infrastructure] Ticket #${ticket_id} UNASSIGNED — no JE available: ${finalTitle}`;
      const emailText = `Dear ${assignment.deskUser.name},

No Junior Engineer is currently available for ${department} / ${campus} campus (the pool is exhausted or everyone is on leave). This ticket needs a JE chosen manually.

======================================================================
TICKET INFORMATION
======================================================================
• Ticket ID:      #TKT-${String(ticket_id).padStart(4, '0')}
• Title:          ${finalTitle}
• Department:     ${department} Engineering
• Category:       ${category}
• Priority:       ${priority}
• Reported By:    ${reporterLine}
• Contact Phone:  ${contact_phone}
• Location:       ${locationBlock}
• Date & Time:    ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

======================================================================
ISSUE DESCRIPTION
======================================================================
${description}

======================================================================
ACTION REQUIRED
======================================================================
Review the ticket and choose a JE from the Deanery portal:

🔗 Review: ${portalUrl}/approvals

Deanery of Infrastructure, IIT Mandi
This is an automated operational notification.`;
      sendEmail(assignment.deskUser.email, emailSubject, emailText);
    }

    res.json({
      success: true,
      ticket_id,
      title: finalTitle,
      status: assignment.status,
      assigned_je_id: assignment.assignedJeId,
    });
  } catch (error) {
    await connection.rollback();
    cleanupTempFiles(req.files);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    connection.release();
  }
};


// PAGINATION & ROLE QUEUES: Get Authority Queue for AE, SE, DEAN, DIRECTOR, CLERICAL, ACCOUNTANT
export const getQueue = async (req, res) => {
  const { role, department } = req.user;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 50;
  const offset = (page - 1) * limit;
  const tab = (req.query.tab || 'pending').toLowerCase();
  const search = req.query.search ? `%${req.query.search.trim()}%` : null;

  const baseSelect = `
    SELECT t.*, 
           u.name as applicant_name, u.email as applicant_email, u.phone as applicant_phone,
           r.estimated_amount, r.nature_of_work,
           tn.nit_number, tn.portal_type, tn.awarded_agency, tn.work_order_value, tn.status as tender_status,
           COALESCE(b.total_billed_amount, 0) as total_billed_amount, COALESCE(b.bills_count, 0) as bills_count
    FROM tickets t
    JOIN users u ON t.applicant_id = u.id
    LEFT JOIN (
      SELECT r1.* FROM reports r1
      JOIN (SELECT ticket_id, MAX(id) as max_id FROM reports GROUP BY ticket_id) r2
      ON r1.id = r2.max_id
    ) r ON t.id = r.ticket_id
    LEFT JOIN (
      SELECT tn1.* FROM tenders tn1
      JOIN (SELECT ticket_id, MAX(id) as max_id FROM tenders GROUP BY ticket_id) tn2
      ON tn1.id = tn2.max_id
    ) tn ON t.id = tn.ticket_id
    LEFT JOIN (
      SELECT ticket_id, SUM(net_amount) as total_billed_amount, COUNT(id) as bills_count
      FROM bills
      GROUP BY ticket_id
    ) b ON t.id = b.ticket_id
  `;

  let whereClauses = [];
  let queryParams = [];

  if (search) {
    whereClauses.push('(t.id LIKE ? OR t.title LIKE ? OR t.description LIKE ? OR u.name LIKE ?)');
    queryParams.push(search, search, search, search);
  }

  if (role === 'AE') {
    // NOTE: still scoped by the AE's single users.department, so an AE whose
    // extra coverage lives only in user_scopes (e.g. the Civil AE also
    // carrying Horticulture for their campus) won't see those tickets here
    // yet. Fixing that means every AE/SE scope check in this file reading
    // from user_scopes -- deferred to Phase 4/6 (workflow + visibility
    // rewrite) per plan.md, not part of this pass.
    whereClauses.push('t.department = ?');
    queryParams.push(department);
    if (tab === 'pending') {
      // UNASSIGNED tickets routed here by the fair-assignment engine
      // (plan.md Q8) surface in the AE's pending tab alongside their normal
      // approval queue.
      whereClauses.push("t.status IN ('PENDING_AE_APPROVAL', 'UNASSIGNED')");
    } else if (tab === 'returned') {
      whereClauses.push("t.status = 'RETURNED_TO_JE'");
    }
  } else if (role === 'SE') {
    whereClauses.push('t.department = ?');
    queryParams.push(department);
    if (tab === 'pending') {
      whereClauses.push("t.status = 'PENDING_SE_APPROVAL'");
    } else if (tab === 'returned') {
      whereClauses.push("t.status IN ('RETURNED_TO_JE', 'PENDING_AE_APPROVAL')");
    }
  } else if (role === 'DEAN') {
    if (tab === 'pending') {
      whereClauses.push("t.status = 'PENDING_DEAN_APPROVAL'");
    } else if (tab === 'high_value') {
      whereClauses.push('r.estimated_amount > 200000');
    }
  } else if (role === 'DIRECTOR') {
    if (tab === 'pending') {
      whereClauses.push("t.status = 'PENDING_DIRECTOR_APPROVAL'");
    } else if (tab === 'capex') {
      whereClauses.push("t.status IN ('APPROVED_FOR_TENDERING', 'TENDER_PUBLISHED', 'WORK_IN_PROGRESS', 'CLOSED')");
    }
  } else if (role === 'CLERICAL') {
    if (tab === 'awaiting_nit' || tab === 'pending') {
      whereClauses.push("t.status = 'APPROVED_FOR_TENDERING'");
    } else if (tab === 'published') {
      whereClauses.push("t.status = 'TENDER_PUBLISHED'");
    } else if (tab === 'in_progress') {
      whereClauses.push("t.status = 'WORK_IN_PROGRESS'");
    } else {
      whereClauses.push("t.status IN ('APPROVED_FOR_TENDERING', 'TENDER_PUBLISHED', 'WORK_IN_PROGRESS', 'CLOSED')");
    }
  } else if (role === 'ACCOUNTANT') {
    if (tab === 'wip') {
      whereClauses.push("t.status = 'WORK_IN_PROGRESS'");
    } else if (tab === 'closed') {
      whereClauses.push("t.status = 'CLOSED'");
    } else {
      whereClauses.push("t.status IN ('APPROVED_FOR_TENDERING', 'TENDER_PUBLISHED', 'WORK_IN_PROGRESS', 'CLOSED')");
    }
  } else if (role !== 'SYSADMIN') {
    return res.status(403).json({ success: false, message: 'Unauthorized role for queue.' });
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const query = `${baseSelect} ${whereSql} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`;
  queryParams.push(limit, offset);

  try {
    const [tickets] = await pool.query(query, queryParams);
    res.json({ success: true, page, limit, tab, tickets });
  } catch (error) {
    console.error('getQueue error:', error);
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
        await safeInsertAttachment(connection, ticketId, fileUrl, req.user.id, 'JE_SITE_PHOTO');
      }

      for (const doc of estimateDocs) {
        const fileUrl = await moveFile(doc, ticketId, 'je_reports/estimate_docs');
        await safeInsertAttachment(connection, ticketId, fileUrl, req.user.id, 'JE_ESTIMATE_DOC');
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
      `SELECT id, status, department FROM tickets WHERE id = ? FOR UPDATE`,
      [ticketId]
    );
    if (rows.length === 0) {
      throw new WorkflowError(`Ticket ${ticketId} not found.`, { code: 'NOT_FOUND', status: 404 });
    }

    const currentStatus = rows[0].status;

    // S7: the reviewer must own this ticket's desk. Without this, the
    // Electrical AE could act on a Civil ticket at PENDING_AE_APPROVAL, since
    // only the role was checked, never the department. Dean/Director/SYSADMIN
    // act institute-wide, so they are not scoped here.
    if ((role === 'AE' || role === 'SE') && rows[0].department !== req.user.department) {
      throw new WorkflowError(
        `Ticket ${ticketId} belongs to the ${rows[0].department} department, not your desk.`,
        { code: 'WRONG_DEPARTMENT', status: 403 }
      );
    }

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

// -------------------------------------------------------------
// TENDER MANAGEMENT (Clerical & JE)
// -------------------------------------------------------------
export const publishTender = async (req, res) => {
  const { ticket_id } = req.params;
  const { nit_number, portal_type, published_date, bid_opening_date, remarks } = req.body;
  const userId = req.user.id;

  if (!nit_number || !nit_number.trim()) {
    return res.status(400).json({ success: false, message: 'NIT / Bid Number is required.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [ticketRows] = await connection.query(
      'SELECT id, status FROM tickets WHERE id = ? FOR UPDATE',
      [ticket_id]
    );
    if (ticketRows.length === 0) {
      throw new Error(`Ticket #${ticket_id} not found.`);
    }

    // S1: a tender can only be published once the ticket has cleared the full
    // approval chain. Without this, any Clerical (or, previously, any JE)
    // request could jump a ticket at ASSIGNED_TO_JE / PENDING_* straight to
    // TENDER_PUBLISHED, bypassing AE/SE/Dean/Director sign-off entirely.
    if (ticketRows[0].status !== 'APPROVED_FOR_TENDERING') {
      throw new WorkflowError(
        `Ticket #${ticket_id} is at ${ticketRows[0].status}; a tender can only be published from APPROVED_FOR_TENDERING.`,
        { code: 'NOT_APPROVED_YET', status: 409 }
      );
    }

    // Insert tender row
    const [tenderResult] = await connection.query(
      `INSERT INTO tenders (ticket_id, nit_number, portal_type, published_date, bid_opening_date, status, remarks, created_by)
       VALUES (?, ?, ?, ?, ?, 'PUBLISHED', ?, ?)`,
      [
        ticket_id,
        nit_number.trim(),
        portal_type || 'GeM',
        published_date || new Date(),
        bid_opening_date || null,
        remarks || null,
        userId,
      ]
    );

    // Compare-and-swap: the WHERE repeats the exact status just validated, so
    // a concurrent request that already moved the ticket loses the race here.
    const [statusResult] = await connection.query(
      "UPDATE tickets SET status = 'TENDER_PUBLISHED' WHERE id = ? AND status = 'APPROVED_FOR_TENDERING'",
      [ticket_id]
    );
    if (statusResult.affectedRows !== 1) {
      throw new WorkflowError(
        'This ticket changed while the tender was being recorded. Reload and try again.',
        { code: 'CONFLICT', status: 409 }
      );
    }

    // Write audit log
    await connection.query(
      `INSERT INTO audit_logs (ticket_id, user_id, action, remarks) VALUES (?, ?, 'PASSED', ?)`,
      [
        ticket_id,
        userId,
        `[Tender Published on ${portal_type || 'GeM'}]: NIT Ref #${nit_number.trim()}${remarks ? ` - ${remarks}` : ''}`
      ]
    );

    await connection.commit();
    res.json({
      success: true,
      tender_id: tenderResult.insertId,
      status: 'TENDER_PUBLISHED',
      message: 'Tender details recorded and status updated to TENDER_PUBLISHED.'
    });
  } catch (error) {
    await connection.rollback();
    if (error instanceof WorkflowError) {
      return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    console.error('publishTender error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  } finally {
    connection.release();
  }
};

export const awardTender = async (req, res) => {
  const { ticket_id } = req.params;
  const { awarded_agency, work_order_value, remarks } = req.body;
  const userId = req.user.id;

  if (!awarded_agency || !awarded_agency.trim()) {
    return res.status(400).json({ success: false, message: 'Awarded Agency Name is required.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [ticketRows] = await connection.query(
      'SELECT id, status FROM tickets WHERE id = ? FOR UPDATE',
      [ticket_id]
    );
    if (ticketRows.length === 0) {
      throw new Error(`Ticket #${ticket_id} not found.`);
    }

    // S1: award is valid either after a tender was published, or as a direct
    // award straight from approval. Any other status (still with a JE/AE/SE/
    // Dean/Director, or already WORK_IN_PROGRESS/CLOSED) is refused.
    const currentStatus = ticketRows[0].status;
    if (!['APPROVED_FOR_TENDERING', 'TENDER_PUBLISHED'].includes(currentStatus)) {
      throw new WorkflowError(
        `Ticket #${ticket_id} is at ${currentStatus}; work can only be awarded from APPROVED_FOR_TENDERING or TENDER_PUBLISHED.`,
        { code: 'NOT_APPROVED_YET', status: 409 }
      );
    }

    // Update or insert tender row
    const [existingTender] = await connection.query(
      'SELECT id FROM tenders WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1',
      [ticket_id]
    );

    const val = work_order_value ? parseFloat(work_order_value) : null;

    if (existingTender.length > 0) {
      await connection.query(
        `UPDATE tenders 
         SET awarded_agency = ?, work_order_value = ?, status = 'AWARDED', remarks = COALESCE(?, remarks)
         WHERE id = ?`,
        [awarded_agency.trim(), val, remarks, existingTender[0].id]
      );
    } else {
      await connection.query(
        `INSERT INTO tenders (ticket_id, nit_number, portal_type, awarded_agency, work_order_value, status, remarks, created_by)
         VALUES (?, 'DIRECT_AWARD', 'GeM', ?, ?, 'AWARDED', ?, ?)`,
        [ticket_id, awarded_agency.trim(), val, remarks, userId]
      );
    }

    // Compare-and-swap on the same status set just validated above.
    const [statusResult] = await connection.query(
      "UPDATE tickets SET status = 'WORK_IN_PROGRESS' WHERE id = ? AND status = ?",
      [ticket_id, currentStatus]
    );
    if (statusResult.affectedRows !== 1) {
      throw new WorkflowError(
        'This ticket changed while the award was being recorded. Reload and try again.',
        { code: 'CONFLICT', status: 409 }
      );
    }

    // Audit log
    await connection.query(
      `INSERT INTO audit_logs (ticket_id, user_id, action, remarks) VALUES (?, ?, 'PASSED', ?)`,
      [
        ticket_id,
        userId,
        `[Work Order Awarded]: Agency: "${awarded_agency.trim()}", Contract Value: INR ${val || 'As per BOQ'}`
      ]
    );

    await connection.commit();
    res.json({
      success: true,
      status: 'WORK_IN_PROGRESS',
      message: 'Work order award recorded and ticket moved to WORK_IN_PROGRESS.'
    });
  } catch (error) {
    await connection.rollback();
    if (error instanceof WorkflowError) {
      return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    console.error('awardTender error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  } finally {
    connection.release();
  }
};

// -------------------------------------------------------------
// BILLS & FINANCIAL LEDGER (Accountant)
// -------------------------------------------------------------
export const recordBill = async (req, res) => {
  const { ticket_id } = req.params;
  const {
    bill_number,
    voucher_number,
    agency_name,
    bill_type,
    gross_amount,
    deductions,
    net_amount,
    payment_status,
    payment_date,
    payment_mode,
    remarks
  } = req.body;
  const userId = req.user.id;

  if (!bill_number || !agency_name || gross_amount === undefined || net_amount === undefined) {
    return res.status(400).json({ success: false, message: 'Bill number, agency name, gross and net amounts are required.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO bills (
        ticket_id, bill_number, voucher_number, agency_name, bill_type,
        gross_amount, deductions, net_amount, payment_status, payment_date,
        payment_mode, remarks, processed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ticket_id,
        bill_number.trim(),
        voucher_number ? voucher_number.trim() : null,
        agency_name.trim(),
        bill_type || 'RA_BILL',
        parseFloat(gross_amount),
        deductions ? parseFloat(deductions) : 0.0,
        parseFloat(net_amount),
        payment_status || 'PENDING',
        payment_date || null,
        payment_mode || 'PFMS',
        remarks || null,
        userId
      ]
    );

    // Audit log
    await connection.query(
      `INSERT INTO audit_logs (ticket_id, user_id, action, remarks) VALUES (?, ?, 'PASSED', ?)`,
      [
        ticket_id,
        userId,
        `[Finance & Accounts]: ${bill_type || 'Bill'} #${bill_number} booked for INR ${parseFloat(net_amount).toLocaleString('en-IN')}`
      ]
    );

    await connection.commit();
    res.json({
      success: true,
      bill_id: result.insertId,
      message: 'Bill recorded in financial accounts ledger.'
    });
  } catch (error) {
    await connection.rollback();
    console.error('recordBill error:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    connection.release();
  }
};

export const updateBillPayment = async (req, res) => {
  const { bill_id } = req.params;
  const { payment_status, voucher_number, payment_date, remarks } = req.body;

  try {
    const updates = [];
    const params = [];

    if (payment_status) { updates.push('payment_status = ?'); params.push(payment_status); }
    if (voucher_number !== undefined) { updates.push('voucher_number = ?'); params.push(voucher_number); }
    if (payment_date) { updates.push('payment_date = ?'); params.push(payment_date); }
    if (remarks !== undefined) { updates.push('remarks = ?'); params.push(remarks); }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No update parameters provided.' });
    }

    params.push(bill_id);
    await pool.query(`UPDATE bills SET ${updates.join(', ')} WHERE id = ?`, params);

    const [updated] = await pool.query('SELECT * FROM bills WHERE id = ?', [bill_id]);
    res.json({ success: true, bill: updated[0] });
  } catch (error) {
    console.error('updateBillPayment error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAccountantOverview = async (req, res) => {
  try {
    // 1. Total sanctioned amount from reports on sanctioned tickets
    const [sanctioned] = await pool.query(`
      SELECT COALESCE(SUM(r.estimated_amount), 0) as total_sanctioned
      FROM reports r
      JOIN (SELECT ticket_id, MAX(id) as max_id FROM reports GROUP BY ticket_id) r_latest ON r.id = r_latest.max_id
      JOIN tickets t ON t.id = r.ticket_id
      WHERE t.status IN ('APPROVED_FOR_TENDERING', 'TENDER_PUBLISHED', 'WORK_IN_PROGRESS', 'CLOSED')
    `);

    // 2. Total contract value awarded
    const [contracts] = await pool.query(`
      SELECT COALESCE(SUM(work_order_value), 0) as total_contract_value
      FROM tenders
      WHERE status = 'AWARDED'
    `);

    // 3. Total disbursed from bills
    const [disbursements] = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN payment_status = 'DISBURSED' THEN net_amount ELSE 0 END), 0) as total_disbursed,
        COALESCE(SUM(CASE WHEN payment_status = 'PENDING' THEN net_amount ELSE 0 END), 0) as total_pending_disbursement,
        COUNT(id) as total_bills_count
      FROM bills
    `);

    res.json({
      success: true,
      summary: {
        totalSanctioned: parseFloat(sanctioned[0]?.total_sanctioned || 0),
        totalContractValue: parseFloat(contracts[0]?.total_contract_value || 0),
        totalDisbursed: parseFloat(disbursements[0]?.total_disbursed || 0),
        totalPendingDisbursement: parseFloat(disbursements[0]?.total_pending_disbursement || 0),
        totalBillsCount: disbursements[0]?.total_bills_count || 0
      }
    });
  } catch (error) {
    console.error('getAccountantOverview error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};