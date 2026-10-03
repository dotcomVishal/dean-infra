import pool from '../config/db.js';
import {
  ACTION, resolveAction, resolveCompletionCheck, planMessages, nextOpenRequestId,
  WorkflowError, deskForStatus, POST_APPROVAL_STATUSES,
} from '../config/workflow.js';
import { cleanupTempFiles, storeAttachments, MAX_FILES_PER_TICKET } from '../utils/fileManager.js';
import { createTicketSchema, formatZodIssues } from '../validation/ticketValidation.js';
import { assignTicket } from '../services/assignment.js';
import { logger } from '../utils/logger.js';
import * as ticketModel from '../models/ticketModel.js';
import * as messageModel from '../models/messageModel.js';
import * as deskModel from '../models/deskModel.js';
import * as reportModel from '../models/reportModel.js';
import { insertAudit } from '../models/auditModel.js';
import { pinsFor, isSelfAction } from './actionController.js';
import { testPrefix } from '../middleware/testRole.js';
import { notifyTicketCreated, notifyTransition, notifyConfirmation } from '../services/notifier.js';
import { kickOutbox } from '../cron/emailReminders.js';
import { loadViewer, uploadCategory, staffRole } from '../services/visibility.js';
import { sendServerError } from '../utils/httpError.js';

/** Files of one multer field, whether multer produced an array (.array) or a map (.fields). */
const filesOf = (files, field) => (Array.isArray(files) ? files.filter((f) => f.fieldname === field) : files?.[field] ?? []);

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
    title, description, type,
    department, campus, landmark, lat, lng, contact_phone,
  } = parsed.data;

  if (type === 'non-recurring' && req.user.role !== 'JE') {
    cleanupTempFiles(req.files);
    return res.status(403).json({ success: false, message: 'Only JEs can initiate non-recurring work.' });
  }

  const finalTitle = title || description.split('\n')[0].substring(0, 90) || 'Campus Infrastructure Request';
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let assignment;
    // If a JE is proposing NON-RECURRING work in their own department (and
    // campus), they inspect it themselves -- a distinct, pre-existing feature
    // (JE-initiated proposals), not part of the fair-assignment pool. Every
    // other ticket, including a normal ticket raised by a JE, goes through the
    // fair auto-assignment engine (which ranks the raiser last).
    let jeCoversCampus = false;
    if (req.user.role === 'JE' && type === 'non-recurring' && req.user.department === department) {
      const [scope] = await connection.query(
        "SELECT 1 FROM infra_user_scopes WHERE user_id = ? AND campus IN (?, 'BOTH') LIMIT 1",
        [req.user.id, campus]);
      jeCoversCampus = scope.length > 0;
    }
    if (jeCoversCampus) {
      assignment = {
        status: 'ASSIGNED_TO_JE',
        assignedJeId: req.user.id,
        currentDeskUserId: req.user.id,
        deskUser: { id: req.user.id, name: req.user.name, email: req.user.email },
      };
    } else {
      assignment = await assignTicket(connection, {
        department, campus, applicantId: applicant_id,
      });
    }

    // D2: no runtime DDL -- schema is owned by migrations only.
    const [ticketResult] = await connection.query(
      `INSERT INTO infra_tickets (
         applicant_id, assigned_je_id, department, title, type, description,
         campus, landmark, lat, lng, priority, contact_phone,
         current_desk_user_id, assigned_ae_id, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        applicant_id, assignment.assignedJeId, department, finalTitle, type, description,
        campus, landmark, lat ?? null, lng ?? null, 'NORMAL', contact_phone,
        assignment.currentDeskUserId,
        assignment.status === 'UNASSIGNED' ? (pinsFor('AE', assignment.deskUser).assignedAeId ?? null) : null,
        assignment.status,
      ]
    );

    const ticket_id = ticketResult.insertId;

    // Insert creation audit logs
    const createdAuditId = await insertAudit(connection, {
      ticketId: ticket_id, userId: applicant_id, action: 'CREATED',
      remarks: `Ticket raised: "${finalTitle}" (${type}, ${campus} campus)`,
    });
    if (req.files && req.files.length > 0) {
      await storeAttachments(connection, {
        ticketId: ticket_id, files: req.files, userId: applicant_id,
        category: 'APPLICANT_EVIDENCE', desk: 'APPLICANT', auditLogId: createdAuditId,
      });
    }
    await insertAudit(connection, {
      ticketId: ticket_id, userId: assignment.currentDeskUserId, action: 'ASSIGNED',
      remarks: assignment.status === 'ASSIGNED_TO_JE'
        ? `Auto-assigned to ${assignment.deskUser.name} (${assignment.deskUser.email})`
        : `UNASSIGNED: no available JE for ${department}/${campus} (pool exhausted or all on leave). ` +
          `Routed to AE ${assignment.deskUser.name} (${assignment.deskUser.email}) for manual assignment.`,
      isSelfAction: assignment.currentDeskUserId === applicant_id,
    });

    // Outbox: the assignment/UNASSIGNED notice + its reminder series + the
    // applicant's stage mail are written in this same transaction (plan.md §3.4).
    await notifyTicketCreated(connection, { ticketId: ticket_id, assignment });

    await connection.commit();
    kickOutbox();

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
    return sendServerError(req, res, error, 'ticketController:140');
  } finally {
    connection.release();
  }
};


const SCOPE_OR_DESK = `(t.current_desk_user_id = ? OR EXISTS (
  SELECT 1 FROM infra_user_scopes s
   WHERE s.user_id = ? AND s.department = t.department AND (t.campus IS NULL OR s.campus IN (t.campus, 'BOTH'))))`;

// PAGINATION & ROLE QUEUES: Get Authority Queue for AE, SE, DEAN, DIRECTOR
export const getQueue = async (req, res) => {
  const { role } = req.user;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 50;
  const offset = (page - 1) * limit;
  const tab = (req.query.tab || 'pending').toLowerCase();
  const search = req.query.search ? `%${req.query.search.trim()}%` : null;

  const baseSelect = `
    SELECT t.*, 
           u.name as applicant_name, u.email as applicant_email, u.phone as applicant_phone,
           hu.name as current_holder_name,
           r.estimated_amount, r.nature_of_work,
           tn.nit_number, tn.portal_type, tn.awarded_agency, tn.award_amount, tn.status as tender_status
    FROM infra_tickets t
    JOIN infra_users u ON t.applicant_id = u.id
    LEFT JOIN infra_users hu ON hu.id = t.current_desk_user_id
    LEFT JOIN (
      SELECT r1.* FROM infra_reports r1
      JOIN (SELECT ticket_id, MAX(id) as max_id FROM infra_reports GROUP BY ticket_id) r2
      ON r1.id = r2.max_id
    ) r ON t.id = r.ticket_id
    LEFT JOIN infra_tenders tn ON tn.ticket_id = t.id
  `;

  // Sysadmin test tickets never appear in real queues.
  let whereClauses = ['t.is_mock = FALSE', 't.deleted_at IS NULL'];
  let queryParams = [];

  if (search) {
    whereClauses.push('(t.id LIKE ? OR t.title LIKE ? OR t.description LIKE ? OR u.name LIKE ?)');
    queryParams.push(search, search, search, search);
  }

  if (role === 'AE') {
    // The ticket is on this AE's desk, or inside their (department, campus)
    // scopes -- never the other campus's tickets (A5).
    whereClauses.push(SCOPE_OR_DESK);
    queryParams.push(req.user.id, req.user.id);
    if (tab === 'pending') {
      // UNASSIGNED tickets routed here by the fair-assignment engine
      // (plan.md Q8) surface in the AE's pending tab alongside their normal
      // approval queue.
      whereClauses.push("t.status IN ('PENDING_AE_APPROVAL', 'UNASSIGNED')");
    } else if (tab === 'returned') {
      whereClauses.push("t.status = 'RETURNED_TO_JE'");
    }
  } else if (role === 'SE') {
    whereClauses.push(SCOPE_OR_DESK);
    queryParams.push(req.user.id, req.user.id);
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
      whereClauses.push(`t.status IN (${POST_APPROVAL_STATUSES.map((st) => `'${st}'`).join(', ')})`);
    }
  } else if (role !== 'SYSADMIN') {
    return res.status(403).json({ success: false, message: 'Unauthorized role for queue.' });
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const query = `${baseSelect} ${whereSql} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`;
  queryParams.push(limit, offset);

  try {
    const [tickets] = await pool.query(query, queryParams);
    res.json({
      success: true, page, limit, tab,
      tickets: tickets.map((t) => ({ ...t, current_desk: deskForStatus(t.status) })),
    });
  } catch (error) {
    return sendServerError(req, res, error, 'getQueue error');
  }
};

// JE SITE REPORT + ESTIMATE  (finding B4: this endpoint did not exist at all,
// so `reports` was never written and every budget ceiling compared against NULL)

// DECIMAL(14,2) = 14 digits total, 2 after the point. Above this MySQL either
// errors (strict mode) or silently rounds -- neither is acceptable for money.
const MAX_ESTIMATE = 999_999_999_999.99;


export async function applyReportSubmission(
  connection, { ticketId, jeId, role, natureOfWork, estimate, remarks, remarkPrefix = '' }
) {
  const ticket = await ticketModel.lockForJe(connection, ticketId, jeId);
  if (!ticket) {
    throw new WorkflowError(
      `Ticket ${ticketId} not found, or it is not assigned to you.`,
      { code: 'NOT_FOUND', status: 404 }
    );
  }
  const currentStatus = ticket.status;

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
      `estimated_amount must be no greater than ${MAX_ESTIMATE} (DECIMAL(14,2)).`,
      { code: 'ESTIMATE_TOO_LARGE', status: 400 });
  }

  // The state machine owns the decision. Note we pass `role` in rather than
  // assuming JE: if someone wires this route to the wrong middleware, the
  // logic still refuses. Do not trust route-level RBAC on its own.
  // A JE is the owner of their own desk by definition (assigned_je_id); tickets
  // routed after Phase 3 also carry it in current_desk_user_id.
  // Same resolution the details page and /actions use (loadActionContext), so the form the JE
  // is shown and the submit the server accepts agree on who holds the desk (stored owner may be stale).
  const deskOwnerId = await deskModel.effectiveOwnerId(connection, ticket, deskForStatus(currentStatus));
  const t = resolveAction({
    user: { id: jeId, role },
    ticket: {
      status: currentStatus,
      current_desk_user_id: deskOwnerId ?? ticket.assigned_je_id,
    },
    action: ACTION.SUBMIT_REPORT,
    estimate: amount,
  });

  // A report filed while a change request is addressed to the JE ANSWERS it:
  // it links to that request and the reply (the report remarks) is mandatory.
  const openRequest = ticket.open_change_request_id
    ? await messageModel.getMessage(connection, ticket.open_change_request_id)
    : null;
  const answersMessageId = openRequest && openRequest.to_desk === 'JE' ? openRequest.id : null;
  const specs = planMessages({
    action: ACTION.SUBMIT_REPORT, fromDesk: t.fromDesk, toDesk: t.toDesk,
    payload: { message: remarks }, openRequest,
  });

  const aeOwner = await deskModel.resolveDeskOwner(connection, ticket, t.toDesk);
  if (!aeOwner) {
    throw new WorkflowError('Nobody is available at the AE desk for this ticket.',
      { code: 'NO_DESK_OWNER', status: 409 });
  }

  // The reports table keeps EVERY version (incrementing per ticket), so a
  // returned-and-refiled ticket preserves its history. The ticket row is
  // locked, so MAX(version)+1 cannot race; uq_report_ticket_version backs it.
  const version = await reportModel.nextVersion(connection, ticketId);
  const reportId = await reportModel.insertReport(connection, {
    ticketId, jeId, version, natureOfWork: natureOfWork.trim(), amount,
    remarks: typeof remarks === 'string' && remarks.trim() ? remarks.trim() : null,
    answersMessageId,
  });

  const thread = ticket.open_change_request_id
    ? await messageModel.getThread(connection, ticket.open_change_request_id)
    : {};
  const applied = await ticketModel.applyTransition(connection, {
    ticketId, fromStatus: t.fromStatus, toStatus: t.toStatus,
    currentDeskUserId: aeOwner.id,
    openChangeRequestId: nextOpenRequestId({
      openId: ticket.open_change_request_id, toDesk: t.toDesk, messagesById: thread,
    }),
    ...pinsFor('AE', aeOwner),
  });
  if (!applied) {
    throw new WorkflowError(
      'This ticket changed while you were working on it. Reload and try again.',
      { code: 'CONFLICT', status: 409 });
  }

  const auditId = await insertAudit(connection, {
    ticketId, userId: jeId, action: t.logAction,
    remarks: `${remarkPrefix}Report v${version} filed, estimate INR ${amount}`,
    fromStatus: t.fromStatus, toStatus: t.toStatus, fromDesk: t.fromDesk, toDesk: t.toDesk,
    isSelfAction: isSelfAction(ticket, jeId),
  });
  for (const spec of specs) {
    spec.to_user_id = (await deskModel.resolveDeskOwner(connection, ticket, spec.to_desk))?.id ?? null;
  }
  await messageModel.insertMessages(connection, {
    ticketId, auditLogId: auditId, authorUserId: jeId, specs,
  });

  return { nextStatus: t.toStatus, fromStatus: t.fromStatus, nextDeskUser: aeOwner, reportId, version, amount, auditId };
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
      remarkPrefix: testPrefix(req),
    });

    // site_photos and estimate_docs travel with the report: same movement, same version.
    const photos = filesOf(req.files, 'site_photos');
    const docs = filesOf(req.files, 'estimate_docs');
    await storeAttachments(connection, {
      ticketId, files: [...photos, ...docs], userId: req.user.id, desk: 'JE',
      category: (file) => (file.fieldname === 'site_photos' ? 'JE_SITE_PHOTO' : 'JE_ESTIMATE_DOC'),
      auditLogId: out.auditId, reportId: out.reportId,
    });

    await notifyTransition(connection, {
      ticketId, fromStatus: out.fromStatus, toStatus: out.nextStatus, action: ACTION.SUBMIT_REPORT,
      toDesk: 'AE', nextDeskUser: out.nextDeskUser, actor: { name: req.user.name, desk: 'JE' },
    });

    await connection.commit();
    kickOutbox();
    res.json({
      success: true, status: out.nextStatus, report_id: out.reportId, version: out.version,
      message: `Report filed. Ticket forwarded to ${out.nextStatus.replace(/_/g, ' ')}.`,
    });
  } catch (error) {
    await connection.rollback();
    cleanupTempFiles(req.files);
    if (error instanceof WorkflowError) {
      return res.status(error.status).json({
        success: false, code: error.code, message: error.message });
    }
    return sendServerError(req, res, error, 'submitReport');
  } finally {
    connection.release();
  }
};


// -------------------------------------------------------------
// FILES FROM ANY DESK: POST /:ticket_id/attachments
// -------------------------------------------------------------
// Anyone who can see the ticket may add files while it is open. The category
// (and so who may read the file) comes from WHO uploads, never from the client:
// see visibility.uploadCategory.
/**
 * Runs BEFORE multer on POST /tickets/:id/attachments: a caller who may not upload gets
 * 403 before a single byte is written to disk. A missing ticket answers the same 403, so ids
 * cannot be probed.
 */
export const checkUploadAllowed = async (req, res, next) => {
  try {
    const ticketId = Number.parseInt(req.params.ticket_id, 10);
    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      return res.status(400).json({ success: false, code: 'BAD_TICKET_ID', message: 'ticket_id must be a positive integer.' });
    }
    const [rows] = await pool.query('SELECT * FROM infra_tickets WHERE id = ?', [ticketId]);
    const ticket = rows[0];
    const viewer = ticket ? await loadViewer(pool, req.user, ticket) : null;
    if (!ticket || !uploadCategory(viewer, ticket)) {
      return res.status(403).json({
        success: false, code: 'UPLOAD_NOT_ALLOWED', message: 'You cannot add files to this ticket (not yours, or already closed).' });
    }
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM infra_attachments WHERE ticket_id = ?', [ticketId]);
    if (n >= MAX_FILES_PER_TICKET) {
      return res.status(409).json({
        success: false, code: 'TICKET_FILE_LIMIT', message: `This ticket already has the maximum of ${MAX_FILES_PER_TICKET} files.` });
    }
    return next();
  } catch (error) {
    return sendServerError(req, res, error, 'checkUploadAllowed');
  }
};

export const uploadAttachments = async (req, res) => {
  const ticketId = Number.parseInt(req.params.ticket_id, 10);
  const files = req.files ?? [];
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    cleanupTempFiles(files);
    return res.status(400).json({ success: false, code: 'BAD_TICKET_ID', message: 'ticket_id must be a positive integer.' });
  }
  if (files.length === 0) {
    return res.status(400).json({ success: false, code: 'NO_FILES', message: 'Attach at least one file.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query('SELECT * FROM infra_tickets WHERE id = ? FOR UPDATE', [ticketId]);
    const ticket = rows[0];
    const viewer = ticket ? await loadViewer(connection, req.user, ticket) : null;
    const category = ticket ? uploadCategory(viewer, ticket) : null;
    if (!category) {
      throw new WorkflowError('You cannot add files to this ticket (not yours, or already closed).',
        { code: 'UPLOAD_NOT_ALLOWED', status: 403 });
    }
    const [[{ n }]] = await connection.query('SELECT COUNT(*) AS n FROM infra_attachments WHERE ticket_id = ?', [ticketId]);
    if (n + files.length > MAX_FILES_PER_TICKET) {
      throw new WorkflowError(`This ticket allows ${MAX_FILES_PER_TICKET} files in total (${n} already attached).`,
        { code: 'TICKET_FILE_LIMIT', status: 409 });
    }
    const desk = staffRole(viewer, ticket) ?? 'APPLICANT';
    // A timeline entry, so a file added without moving the ticket leaves a trace (also a JE adding
    // estimate documents while the ticket is at a higher desk).
    const auditId = await insertAudit(connection, {
      ticketId, userId: req.user.id, action: 'FILES_ADDED',
      remarks: `${testPrefix(req)}${files.length} file${files.length > 1 ? 's' : ''} added by ${desk === 'APPLICANT' ? 'the applicant' : desk}`,
      fromStatus: ticket.status, toStatus: ticket.status,
      isSelfAction: isSelfAction(ticket, req.user.id),
    });
    const ids = await storeAttachments(connection, {
      ticketId, files, userId: req.user.id, category, desk, auditLogId: auditId,
    });
    await connection.commit();
    res.status(201).json({ success: true, category, attachment_ids: ids });
  } catch (error) {
    await connection.rollback();
    cleanupTempFiles(files);
    if (error instanceof WorkflowError) {
      return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    return sendServerError(req, res, error, 'uploadAttachments');
  } finally {
    connection.release();
  }
};

// -------------------------------------------------------------
// CONFIRM A RESOLVED TICKET: POST /:ticket_id/confirm-completion { accepted, remarks }
// -------------------------------------------------------------
// The caller must be the stored confirmer (current_desk_user_id, set at resolve time): the person who
// raised the ticket, or the AE when the JE raised it. Close, or send it back to the status it was
// resolved from. Anyone else gets 404, like a missing ticket.
export const confirmCompletion = async (req, res) => {
  const ticketId = Number.parseInt(req.params.ticket_id, 10);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ success: false, code: 'BAD_TICKET_ID', message: 'ticket_id must be a positive integer.' });
  }
  const { accepted, remarks } = req.body ?? {};

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const row = await ticketModel.lockById(connection, ticketId);
    if (!row || row.current_desk_user_id !== req.user.id) {
      throw new WorkflowError(`Ticket ${ticketId} not found.`, { code: 'NOT_FOUND', status: 404 });
    }
    const [[state]] = await connection.query(
      'SELECT resolved_from_status, resolution_kind FROM infra_tickets WHERE id = ?', [ticketId]);
    const fromStatus = row.status;
    const { status, logAction } = resolveCompletionCheck({ ticket: { ...state, status: fromStatus }, accepted, remarks });

    // Back to a desk status: the holder is re-resolved. Back to work in progress: nobody holds it.
    const backDesk = accepted ? null : deskForStatus(status);
    const holder = backDesk ? await deskModel.resolveDeskOwner(connection, row, backDesk) : null;
    if (backDesk && !holder) {
      throw new WorkflowError(`Nobody is available at the ${backDesk} desk for this ticket.`, { code: 'NO_DESK_OWNER', status: 409 });
    }
    const [upd] = await connection.query(
      accepted
        ? `UPDATE infra_tickets
              SET status = ?, status_changed_at = NOW(), closed_at = NOW(), current_desk_user_id = NULL, open_change_request_id = NULL
            WHERE id = ? AND status = ?`
        : `UPDATE infra_tickets
              SET status = ?, status_changed_at = NOW(), current_desk_user_id = ?, applicant_sent_back_at = NOW(),
                  reopen_count = reopen_count + 1
            WHERE id = ? AND status = ?`,
      accepted ? [status, ticketId, fromStatus] : [status, holder ? holder.id : null, ticketId, fromStatus]);
    if (upd.affectedRows !== 1) {
      throw new WorkflowError('This ticket changed while you were working on it. Reload and try again.',
        { code: 'CONFLICT', status: 409 });
    }
    const note = typeof remarks === 'string' ? remarks.trim() : '';
    const byApplicant = req.user.id === row.applicant_id;
    const who = byApplicant ? 'Applicant' : 'AE';
    const auditId = await insertAudit(connection, {
      ticketId, userId: req.user.id, action: logAction,
      remarks: testPrefix(req) + (accepted
        ? `${who} confirmed the ticket is resolved${note ? `: ${note}` : ''}`
        : `${who}: sent back, not resolved — ${note}`),
      fromStatus, toStatus: status, isSelfAction: isSelfAction(row, req.user.id),
    });
    if (note) {
      // Readable by every desk and the applicant afterwards.
      await messageModel.insertMessages(connection, {
        ticketId, auditLogId: auditId, authorUserId: req.user.id,
        specs: [{ kind: 'PUBLIC_NOTE', author_desk: byApplicant ? 'APPLICANT' : 'AE', to_desk: null, body: note, visible_from_rank: 0 }],
      });
    }
    await notifyConfirmation(connection, { ticketId, actorId: req.user.id, accepted, toStatus: status });
    await connection.commit();
    kickOutbox();
    res.json({ success: true, status, message: accepted ? 'Thank you. Ticket closed.' : 'Sent back to the engineer.' });
  } catch (error) {
    await connection.rollback();
    if (error instanceof WorkflowError) {
      return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    return sendServerError(req, res, error, 'confirmCompletion');
  } finally {
    connection.release();
  }
};
