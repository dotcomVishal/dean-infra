// POST /api/tickets/:ticket_id/lifecycle -- the JE's steps after approval (Master plan, section 7).
// Publish tender, technical and financial evaluation, award, cancel the tender, resolve.
//
// The pure function resolveLifecycleAction (config/workflow.js) decides; this file only moves rows,
// all in one transaction that locks the ticket first: lock, ownership, decide, compare-and-swap update
// (always sets status_changed_at), tender row, audit row, message, files, outbox rows, commit.
import pool from '../config/db.js';
import {
  LIFECYCLE, STATUS, WorkflowError, resolveLifecycleAction, AUTO_CLOSE_DAYS,
} from '../config/workflow.js';
import * as deskModel from '../models/deskModel.js';
import * as messageModel from '../models/messageModel.js';
import { insertAudit } from '../models/auditModel.js';
import { cleanupTempFiles, storeAttachments, MAX_FILES_PER_TICKET } from '../utils/fileManager.js';
import { notifyResolved } from '../services/notifier.js';
import { kickOutbox } from '../cron/emailReminders.js';
import { sendServerError } from '../utils/httpError.js';
import { testPrefix } from '../middleware/testRole.js';
import { isSelfAction } from './actionController.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Who must confirm a resolved ticket: the person who raised it, unless that person is the ticket's own JE
 * (or no longer active), in which case the ticket's AE. Stored in current_desk_user_id at resolve time.
 */
export async function pickConfirmer(connection, ticket) {
  const [rows] = await connection.query(
    'SELECT id, name, email, role, is_active FROM infra_users WHERE id = ?', [ticket.applicant_id]);
  const applicant = rows[0];
  if (applicant && applicant.is_active && applicant.id !== ticket.assigned_je_id) return applicant;
  const ae = await deskModel.resolveDeskOwner(connection, ticket, 'AE');
  if (!ae) {
    throw new WorkflowError('Nobody is available at the AE desk to confirm this ticket.',
      { code: 'NO_DESK_OWNER', status: 409 });
  }
  return ae;
}

// Tender row writes. A ticket moved to a tender stage by an admin has no row yet: create it first,
// so every step can UPDATE.
async function ensureTender(connection, ticketId, userId) {
  await connection.query(
    `INSERT IGNORE INTO infra_tenders (ticket_id, status, created_by) VALUES (?, 'PUBLISHED', ?)`, [ticketId, userId]);
}

async function writeTender(connection, { ticketId, userId, d }) {
  switch (d.action) {
    case LIFECYCLE.PUBLISH_TENDER:
      await connection.query(
        `INSERT INTO infra_tenders (ticket_id, nit_number, portal_type, tender_created_date, tender_end_date, status, created_by)
         VALUES (?, ?, ?, ?, ?, 'PUBLISHED', ?)
         ON DUPLICATE KEY UPDATE nit_number = VALUES(nit_number), portal_type = VALUES(portal_type),
           tender_created_date = VALUES(tender_created_date), tender_end_date = VALUES(tender_end_date), status = 'PUBLISHED'`,
        [ticketId, d.tender.nit_number, d.tender.portal_type, d.tender.tender_created_date, d.tender.tender_end_date, userId]);
      break;
    case LIFECYCLE.START_TECHNICAL_EVAL:
      await ensureTender(connection, ticketId, userId);
      await connection.query(
        `UPDATE infra_tenders SET status = 'TECHNICAL_EVALUATION', technical_eval_at = NOW() WHERE ticket_id = ?`, [ticketId]);
      break;
    case LIFECYCLE.START_FINANCIAL_EVAL:
      await ensureTender(connection, ticketId, userId);
      await connection.query(
        `UPDATE infra_tenders SET status = 'FINANCIAL_EVALUATION', financial_eval_at = NOW() WHERE ticket_id = ?`, [ticketId]);
      break;
    case LIFECYCLE.AWARD:
      await ensureTender(connection, ticketId, userId);
      await connection.query(
        `UPDATE infra_tenders SET status = 'AWARDED', award_amount = ?, awarded_agency = ?, awarded_at = NOW() WHERE ticket_id = ?`,
        [d.tender.award_amount, d.tender.awarded_agency, ticketId]);
      break;
    case LIFECYCLE.CANCEL_TENDER:
      await ensureTender(connection, ticketId, userId);
      await connection.query(
        `UPDATE infra_tenders SET status = 'CANCELLED', cancelled_at = NOW(), cancel_reason = ? WHERE ticket_id = ?`,
        [d.tender.cancel_reason, ticketId]);
      break;
    default:
  }
}

const inr = (n) => `INR ${Number(n).toLocaleString('en-IN')}`;
function auditRemark(d) {
  switch (d.action) {
    case LIFECYCLE.PUBLISH_TENDER:
      return `Tender published (${d.tender.tender_created_date} to ${d.tender.tender_end_date}${d.tender.nit_number ? `, NIT ${d.tender.nit_number}` : ''})`;
    case LIFECYCLE.START_TECHNICAL_EVAL: return 'Technical evaluation started';
    case LIFECYCLE.START_FINANCIAL_EVAL: return 'Financial evaluation started';
    case LIFECYCLE.AWARD: return `Work awarded to ${d.tender.awarded_agency} for ${inr(d.tender.award_amount)}`;
    case LIFECYCLE.CANCEL_TENDER: return `Tender cancelled: ${d.tender.cancel_reason}`;
    default: return `Resolved (${d.resolution === 'COMPLETED' ? 'work completed' : 'closed out from ' + d.fromStatus})${d.note ? `: ${d.note}` : ''}`;
  }
}

export const performLifecycleAction = async (req, res) => {
  const files = req.files ?? [];
  const ticketId = Number.parseInt(req.params.ticket_id, 10);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    cleanupTempFiles(files);
    return res.status(400).json({ success: false, code: 'BAD_TICKET_ID', message: 'ticket_id must be a positive integer.' });
  }
  const body = req.body ?? {};
  const action = typeof body.action === 'string' ? body.action : '';

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Ownership is in the SELECT: another JE's ticket is "not found", like a missing id.
    const [rows] = await connection.query(
      'SELECT * FROM infra_tickets WHERE id = ? AND assigned_je_id = ? FOR UPDATE', [ticketId, req.user.id]);
    const ticket = rows[0];
    if (!ticket) {
      throw new WorkflowError(`Ticket ${ticketId} not found, or it is not assigned to you.`, { code: 'NOT_FOUND', status: 404 });
    }

    const d = resolveLifecycleAction({ user: { id: req.user.id, role: req.user.role }, ticket, action, payload: body });
    const resolves = d.toStatus === STATUS.WORK_COMPLETED;
    const confirmer = resolves ? await pickConfirmer(connection, ticket) : null;

    const [upd] = resolves
      ? await connection.query(
        `UPDATE infra_tickets
            SET status = ?, status_changed_at = NOW(), resolved_from_status = ?, resolved_at = NOW(), resolved_by = ?,
                resolution_kind = ?, current_desk_user_id = ?, applicant_sent_back_at = NULL
          WHERE id = ? AND status = ?`,
        [d.toStatus, d.fromStatus, req.user.id, d.resolution, confirmer.id, ticketId, d.fromStatus])
      : await connection.query(
        'UPDATE infra_tickets SET status = ?, status_changed_at = NOW() WHERE id = ? AND status = ?',
        [d.toStatus, ticketId, d.fromStatus]);
    if (upd.affectedRows !== 1) {
      throw new WorkflowError('This ticket changed while you were working on it. Reload and try again.',
        { code: 'CONFLICT', status: 409 });
    }

    await writeTender(connection, { ticketId, userId: req.user.id, d });

    const auditId = await insertAudit(connection, {
      ticketId, userId: req.user.id, action: d.logAction, remarks: testPrefix(req) + auditRemark(d),
      fromStatus: d.fromStatus, toStatus: d.toStatus, isSelfAction: isSelfAction(ticket, req.user.id),
    });

    if (resolves && d.note) {
      await messageModel.insertMessages(connection, {
        ticketId, auditLogId: auditId, authorUserId: req.user.id,
        specs: [{ kind: 'PUBLIC_NOTE', author_desk: 'JE', to_desk: null, to_user_id: confirmer.id, body: d.note, visible_from_rank: 0 }],
      });
    }

    if (files.length > 0) {
      const [[{ n }]] = await connection.query('SELECT COUNT(*) AS n FROM infra_attachments WHERE ticket_id = ?', [ticketId]);
      if (n + files.length > MAX_FILES_PER_TICKET) {
        throw new WorkflowError(`This ticket allows ${MAX_FILES_PER_TICKET} files in total (${n} already attached).`,
          { code: 'TICKET_FILE_LIMIT', status: 409 });
      }
      await storeAttachments(connection, {
        ticketId, files, userId: req.user.id, category: 'WORK_DOC', desk: 'JE', auditLogId: auditId,
      });
    }

    if (resolves) {
      await notifyResolved(connection, {
        ticketId, confirmer, kind: d.resolution, autoCloseOn: new Date(Date.now() + AUTO_CLOSE_DAYS * DAY_MS),
      });
    }

    await connection.commit();
    kickOutbox();
    res.json({
      success: true, status: d.toStatus, resolution: d.resolution,
      message: resolves ? 'Resolved. The ticket closes after it is confirmed.' : `Ticket updated to ${d.toStatus}`,
    });
  } catch (error) {
    await connection.rollback();
    cleanupTempFiles(files);
    if (error instanceof WorkflowError) {
      return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    return sendServerError(req, res, error, 'performLifecycleAction');
  } finally {
    connection.release();
  }
};
