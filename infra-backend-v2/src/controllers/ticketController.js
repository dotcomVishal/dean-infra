import pool from '../config/db.js';
import {
  ACTION, resolveAction, resolveCompletionCheck, planMessages, nextOpenRequestId, MAX_AMOUNT,
  WorkflowError, deskForStatus, STATUS,
  AE_STAGE, IN_WORK, POST_APPROVAL, TENDER_OPEN,
} from '../config/workflow.js';
import { cleanupTempFiles } from '../utils/fileManager.js';
import { attachFiles } from '../services/attachments.js';
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
import { notifyTicketCreated, notifyTransition, notifyPostApproval } from '../services/notifier.js';
import { kickOutbox } from '../cron/emailReminders.js';
import { LATEST_REPORT, AWARDED_TENDER, EFFECTIVE_AMOUNT } from '../models/amountsModel.js';
import { loadLimits } from '../models/limitsModel.js';
import { redactQueueRow, loadViewer, uploadCategory, staffRole } from '../services/visibility.js';
import { sendServerError, sendWorkflowError } from '../utils/httpError.js';
import { worldClause, findDemoUser } from '../config/demo.js';

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
  // tickets.location stays a derived label for every existing reader (queues,
  // details, emails); it now mirrors the landmark. campus/landmark/lat/lng also
  // land in their own columns below.
  const locationLabel = landmark;

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
        "SELECT 1 FROM user_scopes WHERE user_id = ? AND campus IN (?, 'BOTH') LIMIT 1",
        [req.user.id, campus]);
      jeCoversCampus = scope.length > 0;
    }
    if (req.user.is_demo) {
      // Demo world: the ticket starts at the demo JE. No fair assignment, no "AE assigns" branch.
      const je = await findDemoUser(connection, 'JE');
      if (!je) throw new Error('Demo JE account is missing.');
      assignment = { status: 'ASSIGNED_TO_JE', assignedJeId: je.id, currentDeskUserId: je.id, deskUser: je };
    } else if (jeCoversCampus) {
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
      `INSERT INTO tickets (
         applicant_id, assigned_je_id, department, title, type, description, location,
         campus, landmark, lat, lng, priority, contact_phone,
         current_desk_user_id, assigned_ae_id, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        applicant_id, assignment.assignedJeId, department, finalTitle, type, description, locationLabel,
        campus, landmark, lat ?? null, lng ?? null, 'NORMAL', contact_phone,
        assignment.currentDeskUserId,
        assignment.status === 'UNASSIGNED' ? (pinsFor('AE', assignment.deskUser).assignedAeId ?? null) : null,
        assignment.status,
      ]
    );

    const ticket_id = ticketResult.insertId;

    // Flag a demo ticket before anything can queue mail. is_mock keeps it out of every real list, total and mail path.
    if (req.user.is_demo) {
      await connection.query('UPDATE tickets SET is_mock = TRUE, is_demo = TRUE WHERE id = ?', [ticket_id]);
    }

    // Insert creation audit logs
    const [createdLog] = await connection.query(
      `INSERT INTO audit_logs (ticket_id, user_id, action, remarks) VALUES (?, ?, ?, ?)`,
      [ticket_id, applicant_id, 'CREATED', `Ticket raised: "${finalTitle}" (${type}, ${campus} campus)`]
    );

    await attachFiles(connection, {
      ticketId: ticket_id, files: req.files ?? [], userId: applicant_id, desk: 'APPLICANT',
      category: 'APPLICANT_EVIDENCE', auditLogId: createdLog.insertId,
    });
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
  SELECT 1 FROM user_scopes s
   WHERE s.user_id = ? AND s.department = t.department AND (t.campus IS NULL OR s.campus IN (t.campus, 'BOTH'))))`;

// PAGINATION & ROLE QUEUES: Get Authority Queue for AE, SE, DEAN, DIRECTOR, CLERICAL, ACCOUNTANT
export const getQueue = async (req, res) => {
  const { role } = req.user;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = (page - 1) * limit;
  const tab = (req.query.tab || 'pending').toLowerCase();
  const search = req.query.search ? `%${req.query.search.trim()}%` : null;

  const baseSelect = `
    SELECT t.*, 
           u.name as applicant_name, u.email as applicant_email, u.phone as applicant_phone,
           hu.name as current_holder_name,
           r.estimated_amount, r.nature_of_work, aw.work_order_value AS awarded_amount,
           ${EFFECTIVE_AMOUNT} AS effective_amount,
           tn.nit_number, tn.portal_type, tn.awarded_agency, tn.work_order_value, tn.status as tender_status,
           tn.published_date, tn.bid_end_date,
           COALESCE(b.total_billed_amount, 0) as total_billed_amount, COALESCE(b.bills_count, 0) as bills_count
    FROM tickets t
    JOIN users u ON t.applicant_id = u.id
    LEFT JOIN users hu ON hu.id = t.current_desk_user_id
    LEFT JOIN ${LATEST_REPORT} r ON t.id = r.ticket_id
    LEFT JOIN ${AWARDED_TENDER} aw ON aw.ticket_id = t.id
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

  // Sysadmin test tickets never appear in real queues; a demo viewer sees demo tickets only.
  let whereClauses = [worldClause(req.user)];
  let queryParams = [];

  if (search) {
    whereClauses.push('(t.id LIKE ? OR t.title LIKE ? OR t.description LIKE ? OR u.name LIKE ?)');
    queryParams.push(search, search, search, search);
  }

  if (role === 'AE') {
    // The ticket is on this AE's desk, or inside their (department, campus)
    // scopes -- never the other campus's tickets (A5).
    if (!req.user.is_demo) {
      whereClauses.push(SCOPE_OR_DESK);
      queryParams.push(req.user.id, req.user.id);
    }
    if (tab === 'pending') {
      // UNASSIGNED tickets routed here by the fair-assignment engine
      // (plan.md Q8) surface in the AE's pending tab alongside their normal
      // approval queue.
      whereClauses.push('t.status IN (?)');
      queryParams.push(AE_STAGE);
    } else if (tab === 'returned') {
      whereClauses.push('t.status = ?');
      queryParams.push(STATUS.RETURNED_TO_JE);
    }
  } else if (role === 'SE') {
    if (!req.user.is_demo) {
      whereClauses.push(SCOPE_OR_DESK);
      queryParams.push(req.user.id, req.user.id);
    }
    if (tab === 'pending') {
      whereClauses.push('t.status = ?');
      queryParams.push(STATUS.PENDING_SE_APPROVAL);
    } else if (tab === 'returned') {
      whereClauses.push('t.status IN (?)');
      queryParams.push([STATUS.RETURNED_TO_JE, STATUS.PENDING_AE_APPROVAL]);
    }
  } else if (role === 'DEAN') {
    if (tab === 'pending') {
      whereClauses.push('t.status = ?');
      queryParams.push(STATUS.PENDING_DEAN_APPROVAL);
    } else if (tab === 'high_value') {
      // The threshold lives in financial_limits (F3: no hardcoded ceilings). A missing row shows nothing.
      const limit = (await loadLimits(pool)).DEAN_HIGH_VALUE;
      if (limit == null) whereClauses.push('1 = 0');
      else {
        whereClauses.push(`${EFFECTIVE_AMOUNT} > ?`);
        queryParams.push(limit);
      }
    }
  } else if (role === 'DIRECTOR') {
    if (tab === 'pending') {
      whereClauses.push('t.status = ?');
      queryParams.push(STATUS.PENDING_DIRECTOR_APPROVAL);
    } else if (tab === 'capex') {
      whereClauses.push('t.status IN (?)');
      queryParams.push(POST_APPROVAL);
    }
  } else if (role === 'CLERICAL') {
    if (tab === 'awaiting_nit' || tab === 'pending') {
      whereClauses.push('t.status = ?');
      queryParams.push(STATUS.APPROVED_FOR_TENDERING);
    } else if (tab === 'published') {
      whereClauses.push('t.status IN (?)');
      queryParams.push(TENDER_OPEN);
    } else if (tab === 'in_progress') {
      whereClauses.push('t.status IN (?)');
      queryParams.push(IN_WORK);
    } else {
      whereClauses.push('t.status IN (?)');
      queryParams.push(POST_APPROVAL);
    }
  } else if (role === 'ACCOUNTANT') {
    if (tab === 'wip') {
      whereClauses.push('t.status IN (?)');
      queryParams.push(IN_WORK);
    } else if (tab === 'closed') {
      whereClauses.push('t.status = ?');
      queryParams.push(STATUS.CLOSED);
    } else {
      whereClauses.push('t.status IN (?)');
      queryParams.push(POST_APPROVAL);
    }
  } else if (role !== 'SYSADMIN') {
    return res.status(403).json({ success: false, message: 'You do not have access to this.' });
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const query = `${baseSelect} ${whereSql} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`;
  const filterParams = [...queryParams];
  queryParams.push(limit, offset);

  try {
    const [tickets] = await pool.query(query, queryParams);
    // The page is capped, so say how many match in all: a list that stops at 50 must not look complete.
    const [[{ n: total }]] = await pool.query(
      `SELECT COUNT(*) AS n
         FROM tickets t
         JOIN users u ON t.applicant_id = u.id
         LEFT JOIN ${LATEST_REPORT} r ON t.id = r.ticket_id
         LEFT JOIN ${AWARDED_TENDER} aw ON aw.ticket_id = t.id
        ${whereSql}`, filterParams);
    const viewer = { role };
    res.json({
      success: true, page, limit, tab, total: Number(total),
      tickets: tickets.map((t) => redactQueueRow(viewer, { ...t, current_desk: deskForStatus(t.status) })),
    });
  } catch (error) {
    return sendServerError(req, res, error, 'getQueue error');
  }
};

// JE SITE REPORT + ESTIMATE  (finding B4: this endpoint did not exist at all,
// so `reports` was never written and every budget ceiling compared against NULL)

// DECIMAL(15,2): above this MySQL either errors (strict mode) or silently
// rounds -- neither is acceptable for money. One limit for every amount (workflow.MAX_AMOUNT).
const MAX_ESTIMATE = MAX_AMOUNT;

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
      `estimated_amount must be no greater than ${MAX_ESTIMATE}.`,
      { code: 'ESTIMATE_TOO_LARGE', status: 400 });
  }

  // The state machine owns the decision. Note we pass `role` in rather than
  // assuming JE: if someone wires this route to the wrong middleware, the
  // logic still refuses. Do not trust route-level RBAC on its own.
  // A JE is the owner of their own desk by definition (assigned_je_id); tickets
  // routed after Phase 3 also carry it in current_desk_user_id.
  const t = resolveAction({
    user: { id: jeId, role },
    ticket: {
      status: currentStatus,
      current_desk_user_id: ticket.current_desk_user_id ?? ticket.assigned_je_id,
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
    if (!spec.to_desk) continue; // a note with no recipient must not trigger a desk lookup (R7)
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

    // Handle uploaded files (site_photos and estimate_docs), tied to this report version and movement
    const byField = (name) => (Array.isArray(req.files)
      ? req.files.filter((f) => f.fieldname === name)
      : req.files?.[name] ?? []);
    for (const [field, category] of [['site_photos', 'JE_SITE_PHOTO'], ['estimate_docs', 'JE_ESTIMATE_DOC']]) {
      await attachFiles(connection, {
        ticketId, files: byField(field), userId: req.user.id, desk: 'JE', category,
        auditLogId: out.auditId, reportId: out.reportId,
      });
    }

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
    if (error instanceof WorkflowError) return sendWorkflowError(req, res, error);
    return sendServerError(req, res, error, 'submitReport');
  } finally {
    connection.release();
  }
};


// -------------------------------------------------------------
// BILLS & FINANCIAL LEDGER (Accountant)
// -------------------------------------------------------------
const BILL_TYPES = ['RA_BILL', 'FINAL_BILL', 'ADVANCE', 'SECURITY_REFUND'];
const PAYMENT_STATUSES = ['PENDING', 'VERIFIED', 'DISBURSED', 'REJECTED'];

/** Money from a request body: a finite number, zero or more, within the column. */
const money = (value, field, { min = 0, required = true } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) throw new WorkflowError(`${field} is required.`, { code: 'AMOUNT_REQUIRED', status: 400 });
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > MAX_AMOUNT) {
    throw new WorkflowError(`${field} must be a number between ${min} and ${MAX_AMOUNT}.`, { code: 'AMOUNT_INVALID', status: 400 });
  }
  return n;
};
const oneOf = (value, list, field, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (!list.includes(value)) {
    throw new WorkflowError(`${field} must be one of ${list.join(', ')}.`, { code: 'INVALID_VALUE', status: 400 });
  }
  return value;
};
const textOf = (v) => (typeof v === 'string' ? v.trim() : '');

// Bills belong to approved work: refuse one on a ticket that is not post-approval.
async function lockBillableTicket(connection, ticketId) {
  const [rows] = await connection.query('SELECT id, status FROM tickets WHERE id = ? FOR UPDATE', [ticketId]);
  if (rows.length === 0) throw new WorkflowError(`Ticket ${ticketId} not found.`, { code: 'NOT_FOUND', status: 404 });
  if (!POST_APPROVAL.includes(rows[0].status)) {
    throw new WorkflowError('Bills can only be booked after approval.',
      { code: 'BILL_NOT_ALLOWED', status: 409 });
  }
  return rows[0];
}

export const recordBill = async (req, res) => {
  const ticketId = Number.parseInt(req.params.ticket_id, 10);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ success: false, code: 'BAD_TICKET_ID', message: 'ticket_id must be a positive integer.' });
  }
  const body = req.body ?? {};
  const userId = req.user.id;

  const connection = await pool.getConnection();
  try {
    const billNumber = textOf(body.bill_number);
    const agency = textOf(body.agency_name);
    if (!billNumber || !agency) {
      throw new WorkflowError('Bill number and agency name are required.', { code: 'BILL_FIELDS_REQUIRED', status: 400 });
    }
    const gross = money(body.gross_amount, 'gross_amount');
    const net = money(body.net_amount, 'net_amount');
    const deductions = money(body.deductions, 'deductions', { required: false }) ?? 0;
    const billType = oneOf(body.bill_type, BILL_TYPES, 'bill_type', 'RA_BILL');
    const paymentStatus = oneOf(body.payment_status, PAYMENT_STATUSES, 'payment_status', 'PENDING');

    await connection.beginTransaction();
    await lockBillableTicket(connection, ticketId);

    const [result] = await connection.query(
      `INSERT INTO bills (
        ticket_id, bill_number, voucher_number, agency_name, bill_type,
        gross_amount, deductions, net_amount, payment_status, payment_date,
        payment_mode, remarks, processed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ticketId, billNumber, textOf(body.voucher_number) || null, agency, billType,
        gross, deductions, net, paymentStatus, body.payment_date || null,
        textOf(body.payment_mode) || 'PFMS', body.remarks || null, userId,
      ]
    );
    await insertAudit(connection, {
      ticketId, userId, action: 'BILL_RECORDED',
      remarks: `[Finance & Accounts]: ${billType} #${billNumber} booked for INR ${net.toLocaleString('en-IN')}`,
    });

    await connection.commit();
    res.json({ success: true, bill_id: result.insertId, message: 'Bill recorded in financial accounts ledger.' });
  } catch (error) {
    await connection.rollback();
    if (error instanceof WorkflowError) return sendWorkflowError(req, res, error);
    return sendServerError(req, res, error, 'recordBill error');
  } finally {
    connection.release();
  }
};

export const updateBillPayment = async (req, res) => {
  const billId = Number.parseInt(req.params.bill_id, 10);
  if (!Number.isInteger(billId) || billId <= 0) {
    return res.status(400).json({ success: false, code: 'BAD_BILL_ID', message: 'bill_id must be a positive integer.' });
  }
  const { voucher_number, payment_date, remarks } = req.body ?? {};

  const connection = await pool.getConnection();
  try {
    const status = oneOf(req.body?.payment_status, PAYMENT_STATUSES, 'payment_status', undefined);
    const updates = [];
    const params = [];
    if (status) { updates.push('payment_status = ?'); params.push(status); }
    if (voucher_number !== undefined) { updates.push('voucher_number = ?'); params.push(textOf(voucher_number) || null); }
    if (payment_date) { updates.push('payment_date = ?'); params.push(payment_date); }
    if (remarks !== undefined) { updates.push('remarks = ?'); params.push(remarks); }
    if (updates.length === 0) {
      throw new WorkflowError('No update parameters provided.', { code: 'NOTHING_TO_UPDATE', status: 400 });
    }

    await connection.beginTransaction();
    const [bills] = await connection.query('SELECT id, ticket_id, bill_number, payment_status FROM bills WHERE id = ? FOR UPDATE', [billId]);
    if (bills.length === 0) throw new WorkflowError(`Bill ${billId} not found.`, { code: 'NOT_FOUND', status: 404 });
    const bill = bills[0];
    await lockBillableTicket(connection, bill.ticket_id);

    await connection.query(`UPDATE bills SET ${updates.join(', ')} WHERE id = ?`, [...params, billId]);
    await insertAudit(connection, {
      ticketId: bill.ticket_id, userId: req.user.id, action: 'BILL_UPDATED',
      remarks: `[Finance & Accounts]: bill #${bill.bill_number} updated${status ? `, payment ${bill.payment_status} -> ${status}` : ''}`,
    });
    const [updated] = await connection.query('SELECT * FROM bills WHERE id = ?', [billId]);
    await connection.commit();
    res.json({ success: true, bill: updated[0] });
  } catch (error) {
    await connection.rollback();
    if (error instanceof WorkflowError) return sendWorkflowError(req, res, error);
    return sendServerError(req, res, error, 'updateBillPayment error');
  } finally {
    connection.release();
  }
};

export const getAccountantOverview = async (req, res) => {
  try {
    // 1. Total sanctioned amount on approved tickets: the award where there is one, else the JE's estimate
    const [sanctioned] = await pool.query(`
      SELECT COALESCE(SUM(${EFFECTIVE_AMOUNT}), 0) as total_sanctioned
      FROM tickets t
      LEFT JOIN ${LATEST_REPORT} r ON r.ticket_id = t.id
      LEFT JOIN ${AWARDED_TENDER} aw ON aw.ticket_id = t.id
      WHERE t.status IN (?)
        AND ${worldClause(req.user)}
    `, [POST_APPROVAL]);

    // 2. Total contract value awarded
    const [contracts] = await pool.query(`
      SELECT COALESCE(SUM(tn.work_order_value), 0) as total_contract_value
      FROM tenders tn JOIN tickets t ON t.id = tn.ticket_id
      WHERE tn.status = 'AWARDED' AND ${worldClause(req.user)}
    `);

    // 3. Total disbursed from bills
    const [disbursements] = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN b.payment_status = 'DISBURSED' THEN b.net_amount ELSE 0 END), 0) as total_disbursed,
        COALESCE(SUM(CASE WHEN b.payment_status = 'PENDING' THEN b.net_amount ELSE 0 END), 0) as total_pending_disbursement,
        COUNT(b.id) as total_bills_count
      FROM bills b JOIN tickets t ON t.id = b.ticket_id
      WHERE ${worldClause(req.user)}
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
    return sendServerError(req, res, error, 'getAccountantOverview error');
  }
};
// -------------------------------------------------------------
// FILES FROM ANY DESK: POST /:ticket_id/attachments
// -------------------------------------------------------------
// Anyone who can see the ticket may add files while it is open. The category
// (and so who may read the file) comes from WHO uploads, never from the client:
// see visibility.uploadCategory.
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
    const [rows] = await connection.query('SELECT * FROM tickets WHERE id = ? FOR UPDATE', [ticketId]);
    const ticket = rows[0];
    const viewer = ticket ? await loadViewer(connection, req.user, ticket) : null;
    const category = ticket ? uploadCategory(viewer, ticket) : null;
    if (!category) {
      throw new WorkflowError('You cannot add files to this ticket (not yours, or already closed).',
        { code: 'UPLOAD_NOT_ALLOWED', status: 403 });
    }
    const ids = await attachFiles(connection, {
      ticketId, files, userId: req.user.id, desk: staffRole(viewer, ticket) ?? 'APPLICANT', category,
    });
    await connection.commit();
    res.status(201).json({ success: true, category, attachment_ids: ids });
  } catch (error) {
    await connection.rollback();
    cleanupTempFiles(files);
    if (error instanceof WorkflowError) return sendWorkflowError(req, res, error);
    return sendServerError(req, res, error, 'uploadAttachments');
  } finally {
    connection.release();
  }
};

// -------------------------------------------------------------
// APPLICANT CLOSES: POST /:ticket_id/confirm-completion { accepted, remarks }
// -------------------------------------------------------------
export const confirmCompletion = async (req, res) => {
  const ticketId = Number.parseInt(req.params.ticket_id, 10);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ success: false, code: 'BAD_TICKET_ID', message: 'ticket_id must be a positive integer.' });
  }
  const { accepted, remarks } = req.body ?? {};

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Ownership in the SELECT: only the person who raised the ticket may answer.
    const [rows] = await connection.query(
      `SELECT id, status, resolved_from_status, assigned_je_id, open_change_request_id
         FROM tickets WHERE id = ? AND applicant_id = ? FOR UPDATE`, [ticketId, req.user.id]);
    if (rows.length === 0) {
      throw new WorkflowError(`Ticket ${ticketId} not found.`, { code: 'NOT_FOUND', status: 404 });
    }
    const ticket = rows[0];
    const fromStatus = ticket.status;
    const [reportRows] = await connection.query('SELECT 1 FROM reports WHERE ticket_id = ? LIMIT 1', [ticketId]);
    const { status, logAction } = resolveCompletionCheck({
      currentStatus: fromStatus, accepted, remarks,
      resolvedFrom: ticket.resolved_from_status, hasReport: reportRows.length > 0,
    });

    // Accepted: the ticket is finished, so no change request stays open. Sent back: the ticket returns to its
    // JE; an open change request that is not addressed to the JE is no longer theirs to answer.
    let openRequest = ticket.open_change_request_id;
    if (accepted === true) openRequest = null;
    else if (openRequest != null && (await messageModel.getMessage(connection, openRequest))?.to_desk !== 'JE') openRequest = null;
    const [upd] = await connection.query(
      `UPDATE tickets
          SET status = ?, status_changed_at = NOW(), open_change_request_id = ?
              ${accepted === true ? '' : ', current_desk_user_id = assigned_je_id, resolved_from_status = NULL, resolved_at = NULL'}
        WHERE id = ? AND status = ?`,
      [status, openRequest, ticketId, fromStatus]);
    if (upd.affectedRows !== 1) {
      throw new WorkflowError('This ticket changed while you were working on it. Reload and try again.',
        { code: 'CONFLICT', status: 409 });
    }
    const note = typeof remarks === 'string' ? remarks.trim() : '';
    await insertAudit(connection, {
      ticketId, userId: req.user.id, action: logAction,
      remarks: testPrefix(req) + (accepted ? `Applicant confirmed the work is done${note ? `: ${note}` : ''}` : `Applicant: work not done — ${note}`),
      fromStatus, toStatus: status,
    });
    await notifyPostApproval(connection, {
      ticketId, fromStatus, toStatus: status, message: note,
    });
    await connection.commit();
    kickOutbox();
    res.json({ success: true, status, message: accepted ? 'Thank you. Ticket closed.' : 'Sent back to the engineer.' });
  } catch (error) {
    await connection.rollback();
    if (error instanceof WorkflowError) return sendWorkflowError(req, res, error);
    return sendServerError(req, res, error, 'confirmCompletion');
  } finally {
    connection.release();
  }
};
