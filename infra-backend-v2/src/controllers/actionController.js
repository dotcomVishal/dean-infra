// POST /api/tickets/:ticket_id/actions — the one endpoint every desk action
// goes through (plan.md §4 Phase 4 item 2; replaces the old /review).
//
// Controller only orchestrates: zod validates the payload BEFORE a
// transaction opens, the pure state machine (config/workflow.js) decides,
// the models (src/models) move the rows, all inside one transaction that
// locks the ticket row first.
import pool from '../config/db.js';
import {
  ACTION, resolveAction, planMessages, nextOpenRequestId, WorkflowError,
} from '../config/workflow.js';
import { actionSchema } from '../validation/actionValidation.js';
import { loadActionContext } from '../services/actionContext.js';
import * as ticketModel from '../models/ticketModel.js';
import * as messageModel from '../models/messageModel.js';
import * as deskModel from '../models/deskModel.js';
import { insertAudit } from '../models/auditModel.js';
import { notifyTransition } from '../services/notifier.js';
import { kickOutbox } from '../cron/emailReminders.js';
import { sendServerError } from '../utils/httpError.js';

const neutralRemark = (t, actorName) => {
  switch (t.action) {
    case ACTION.FORWARD:         return `Forwarded ${t.fromDesk} -> ${t.toDesk} by ${actorName}`;
    case ACTION.APPROVE:         return `Approved by ${t.fromDesk} (${actorName})`;
    case ACTION.REJECT:          return `Rejected by ${t.fromDesk} (${actorName})`;
    case ACTION.REQUEST_CHANGES: return `${t.fromDesk} requested changes from ${t.toDesk} (${actorName})`;
    case ACTION.ASSIGN_JE:       return `JE chosen by ${t.fromDesk} (${actorName})`;
    default:                     return t.action;
  }
};

export const performTicketAction = async (req, res) => {
  const ticketId = Number.parseInt(req.params.ticket_id, 10);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({
      success: false, code: 'BAD_TICKET_ID', message: 'ticket_id must be a positive integer.' });
  }

  const parsed = actionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Invalid action payload.',
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const { action, to_desk, message, internal_remark, public_note, assignee_id } = parsed.data;
  // Identity comes from the verified token + DB row, never from the payload.
  const user = { id: req.user.id, role: req.user.role };

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const row = await ticketModel.lockById(connection, ticketId);
    if (!row) throw new WorkflowError(`Ticket ${ticketId} not found.`, { code: 'NOT_FOUND', status: 404 });

    const { ticket, limits } = await loadActionContext(connection, row, user);
    const t = resolveAction({ user, ticket, limits, action, to_desk });

    const openRequest = row.open_change_request_id
      ? await messageModel.getMessage(connection, row.open_change_request_id)
      : null;
    const specs = planMessages({
      action: t.action, fromDesk: t.fromDesk, toDesk: t.toDesk,
      payload: { message, internal_remark, public_note }, openRequest,
    });

    // Who holds the ticket next.
    let nextDeskUser = null;
    let assignedJeId;
    if (action === ACTION.ASSIGN_JE) {
      nextDeskUser = await deskModel.getEligibleJe(connection, assignee_id, row.department, row.campus);
      if (!nextDeskUser) {
        throw new WorkflowError(
          `User ${assignee_id} is not an active JE covering ${row.department}${row.campus ? ` (${row.campus})` : ''}.`,
          { code: 'INVALID_ASSIGNEE', status: 400 });
      }
      assignedJeId = nextDeskUser.id;
    } else if (t.toDesk === 'JE') {
      nextDeskUser = await deskModel.findDeskOwner(connection, row, 'JE');
    } else if (t.toDesk) {
      nextDeskUser = await deskModel.resolveDeskOwner(connection, row, t.toDesk);
    }
    if (t.toDesk && !nextDeskUser) {
      throw new WorkflowError(`Nobody is available at the ${t.toDesk} desk for this ticket.`,
        { code: 'NO_DESK_OWNER', status: 409 });
    }

    const opensNewRequest = t.action === ACTION.REQUEST_CHANGES;
    const carriedOpen = opensNewRequest
      ? row.open_change_request_id
      : nextOpenRequestId({
          openId: row.open_change_request_id,
          toDesk: t.toDesk,
          messagesById: row.open_change_request_id
            ? await messageModel.getThread(connection, row.open_change_request_id)
            : {},
        });

    const applied = await ticketModel.applyTransition(connection, {
      ticketId, fromStatus: t.fromStatus, toStatus: t.toStatus,
      currentDeskUserId: nextDeskUser ? nextDeskUser.id : null,
      openChangeRequestId: carriedOpen, assignedJeId,
    });
    if (!applied) {
      throw new WorkflowError('This ticket changed while you were working on it. Reload and try again.',
        { code: 'CONFLICT', status: 409 });
    }

    const auditId = await insertAudit(connection, {
      ticketId, userId: user.id, action: t.logAction, remarks: neutralRemark(t, req.user.name),
      fromStatus: t.fromStatus, toStatus: t.toStatus, fromDesk: t.fromDesk, toDesk: t.toDesk,
      visibility: opensNewRequest ? 'INTERNAL' : 'ALL',
    });

    // to_user_id is resolved now so the record says exactly who received it.
    for (const spec of specs) {
      if (!spec.to_desk) continue;
      spec.to_user_id = spec.to_desk === t.toDesk && nextDeskUser
        ? nextDeskUser.id
        : (await deskModel.resolveDeskOwner(connection, row, spec.to_desk))?.id ?? null;
    }
    const messageIds = await messageModel.insertMessages(connection, {
      ticketId, auditLogId: auditId, authorUserId: user.id, specs,
    });

    let openChangeRequestId = carriedOpen;
    if (opensNewRequest) {
      openChangeRequestId = messageIds[specs.findIndex((s) => s.kind === 'CHANGE_REQUEST')];
      await ticketModel.setOpenChangeRequest(connection, ticketId, openChangeRequestId);
    }

    // Outbox rows (desk mail, reminders, sanitized applicant stage mail) commit
    // with the move itself.
    await notifyTransition(connection, {
      ticketId, fromStatus: t.fromStatus, toStatus: t.toStatus, action: t.action, toDesk: t.toDesk,
      nextDeskUser, actor: { name: req.user.name, desk: t.fromDesk },
      message: opensNewRequest ? message : null,
    });

    await connection.commit();
    kickOutbox();
    res.json({
      success: true,
      status: t.toStatus,
      current_desk_user_id: nextDeskUser ? nextDeskUser.id : null,
      open_change_request_id: openChangeRequestId ?? null,
      message: `Ticket updated to ${t.toStatus}`,
    });
  } catch (error) {
    await connection.rollback();
    if (error instanceof WorkflowError) {
      return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    return sendServerError(req, res, error, 'performTicketAction');
  } finally {
    connection.release();
  }
};
