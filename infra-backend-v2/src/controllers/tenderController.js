// The JE's post-approval work (Master-plan Phase 5):
//   POST /api/tickets/:ticket_id/tender-stage   publish / technical / financial / award / cancel
//   POST /api/tickets/:ticket_id/resolve        mark the ticket resolved, at any open stage
//
// Controller only orchestrates: the pure rules are in config/workflow.js
// (resolveTenderStage, resolveResolution). Both endpoints lock the ticket row,
// move it with a compare-and-swap, write the audit row and any files in the same
// transaction. tenders.status is written only here, in that transaction, so it
// cannot drift from tickets.status.
import pool from '../config/db.js';
import { STATUS, WorkflowError, resolveTenderStage, resolveResolution, deskForStatus } from '../config/workflow.js';
import * as ticketModel from '../models/ticketModel.js';
import { insertAudit } from '../models/auditModel.js';
import { attachFiles } from '../services/attachments.js';
import { notifyPostApproval } from '../services/notifier.js';
import { cleanupTempFiles } from '../utils/fileManager.js';
import { sendServerError, sendWorkflowError } from '../utils/httpError.js';
import { kickOutbox } from '../cron/emailReminders.js';
import { testPrefix } from '../middleware/testRole.js';

const conflict = () => new WorkflowError(
  'This ticket changed while you were working on it. Reload and try again.', { code: 'CONFLICT', status: 409 });
const notYours = (id) => new WorkflowError(
  `Ticket ${id} not found, or it is not assigned to you.`, { code: 'NOT_FOUND', status: 404 });

const badId = (res, files) => {
  cleanupTempFiles(files);
  return res.status(400).json({ success: false, code: 'BAD_TICKET_ID', message: 'ticket_id must be a positive integer.' });
};

/** Compare-and-swap of the status alone; the row is already locked and validated. */
async function moveStatus(connection, { ticketId, from, to, extra = '', params = [] }) {
  const [r] = await connection.query(
    `UPDATE tickets SET status = ?, status_changed_at = NOW() ${extra} WHERE id = ? AND status = ?`,
    [to, ...params, ticketId, from]);
  if (r.affectedRows !== 1) throw conflict();
}

const describe = (stage, p, t) => {
  switch (stage) {
    case 'PUBLISH': return `Tender published on ${t.portal_type}: NIT ${t.nit_number}, open ${t.published_date} to ${t.bid_end_date}`;
    case 'TECHNICAL': return 'Technical evaluation started';
    case 'FINANCIAL': return 'Financial evaluation started';
    case 'AWARD': return `Work awarded to ${t.awarded_agency}, INR ${t.work_order_value}`;
    default: return `Tender cancelled: ${t.cancel_reason}`;
  }
};

export const applyTenderStage = async (req, res) => {
  const ticketId = Number.parseInt(req.params.ticket_id, 10);
  const files = req.files ?? [];
  if (!Number.isInteger(ticketId) || ticketId <= 0) return badId(res, files);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const ticket = await ticketModel.lockForJe(connection, ticketId, req.user.id);
    if (!ticket) throw notYours(ticketId);

    const body = req.body ?? {};
    const step = resolveTenderStage({ currentStatus: ticket.status, stage: String(body.stage ?? '').toUpperCase(), payload: body });

    // The tenders row: a new one when publishing (a re-tender keeps the cancelled row as history),
    // otherwise the latest one moves along.
    const t = step.tender;
    let tenderId;
    if (t.op === 'insert') {
      const [ins] = await connection.query(
        `INSERT INTO tenders (ticket_id, nit_number, portal_type, published_date, bid_end_date, status, remarks, created_by)
         VALUES (?, ?, ?, ?, ?, 'PUBLISHED', ?, ?)`,
        [ticketId, t.nit_number, t.portal_type, t.published_date, t.bid_end_date, t.remarks, req.user.id]);
      tenderId = ins.insertId;
    } else {
      const [[latest]] = await connection.query(
        'SELECT id FROM tenders WHERE ticket_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE', [ticketId]);
      if (!latest) {
        throw new WorkflowError('No tender is recorded for this ticket. Publish one first.',
          { code: 'NO_TENDER', status: 409 });
      }
      tenderId = latest.id;
      const sets = ['status = ?', 'remarks = COALESCE(?, remarks)'];
      const params = [t.status, t.remarks];
      for (const col of ['awarded_agency', 'work_order_value', 'cancel_reason']) {
        if (t[col] !== undefined) { sets.push(`${col} = ?`); params.push(t[col]); }
      }
      await connection.query(`UPDATE tenders SET ${sets.join(', ')} WHERE id = ?`, [...params, tenderId]);
    }

    await moveStatus(connection, { ticketId, from: ticket.status, to: step.toStatus });
    const auditId = await insertAudit(connection, {
      ticketId, userId: req.user.id, action: step.logAction,
      remarks: `${testPrefix(req)}${describe(step.stage, body, t)}${t.remarks ? ` - ${t.remarks}` : ''}`,
      fromStatus: ticket.status, toStatus: step.toStatus, fromDesk: deskForStatus(ticket.status), toDesk: null,
    });
    await attachFiles(connection, {
      ticketId, files, userId: req.user.id, desk: 'JE', category: 'CLERK_TENDER_DOC', auditLogId: auditId,
    });

    await connection.commit();
    res.json({ success: true, status: step.toStatus, tender_id: tenderId, message: `Ticket updated to ${step.toStatus}` });
  } catch (error) {
    await connection.rollback();
    cleanupTempFiles(files);
    if (error instanceof WorkflowError) return sendWorkflowError(req, res, error);
    return sendServerError(req, res, error, 'applyTenderStage');
  } finally {
    connection.release();
  }
};

export const resolveTicket = async (req, res) => {
  const ticketId = Number.parseInt(req.params.ticket_id, 10);
  if (!Number.isInteger(ticketId) || ticketId <= 0) return badId(res, []);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const ticket = await ticketModel.lockForJe(connection, ticketId, req.user.id);
    if (!ticket) throw notYours(ticketId);

    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    const out = resolveResolution({ currentStatus: ticket.status, note });

    await moveStatus(connection, {
      ticketId, from: ticket.status, to: out.toStatus,
      extra: ', current_desk_user_id = NULL, resolved_from_status = ?, resolved_at = NOW()', params: [out.resolvedFrom],
    });
    await connection.query(
      "UPDATE notifications SET status = 'CANCELLED', locked_until = NULL WHERE ticket_id = ? AND kind = 'REMINDER' AND status = 'PENDING'",
      [ticketId]);
    await insertAudit(connection, {
      ticketId, userId: req.user.id, action: out.logAction,
      remarks: `${testPrefix(req)}${out.early ? '[OVERRIDE] ' : ''}Resolved from ${out.resolvedFrom}: ${note}`,
      fromStatus: ticket.status, toStatus: out.toStatus, fromDesk: deskForStatus(ticket.status), toDesk: null,
      visibility: out.early ? 'INTERNAL' : 'ALL',
    });
    await notifyPostApproval(connection, { ticketId, fromStatus: ticket.status, toStatus: STATUS.WORK_COMPLETED });

    await connection.commit();
    kickOutbox();
    res.json({ success: true, status: out.toStatus, message: 'Marked resolved. The applicant will be asked to verify.' });
  } catch (error) {
    await connection.rollback();
    if (error instanceof WorkflowError) return sendWorkflowError(req, res, error);
    return sendServerError(req, res, error, 'resolveTicket');
  } finally {
    connection.release();
  }
};
