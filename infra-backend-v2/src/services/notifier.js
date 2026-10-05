// ============================================================
//  NOTIFIER — the write side of the outbox (plan.md §3.4, §4 Phase 5).
//
//  Every function takes the caller's open transaction `connection`, so the
//  notification rows commit or roll back together with the workflow move that
//  caused them: no mail for a move that never happened, no move whose mail is
//  lost. Nothing here talks to SMTP -- cron/emailReminders.js sends.
//
//  WHO gets WHAT is decided in services/emailPolicy.js, not here: this file
//  says which event happened, the policy says whether that recipient is mailed.
//
//  JE reminder cadence (hours after the assignment): 0 (instant), 12, 24, 72,
//  then every 24 h. Only the JE is reminded.
// ============================================================
import { STATUS, ACTION, JE_STAGE } from '../config/workflow.js';
import { findDeskOwner } from '../models/deskModel.js';
import { cancelReminders } from '../models/notificationModel.js';
import { EVENT, queueFor, startReminders } from './emailPolicy.js';

import {
  jeAssignedEmail, jeReassignedAwayEmail, changesRequestedEmail, jeOutcomeEmail, jeSentBackEmail,
  arrivalEmail, applicantEventEmail,
} from './emailTemplates.js';

const HOUR = 60 * 60 * 1000;
export const REMINDER_OFFSETS_HOURS = Object.freeze([0, 12, 24, 72]);
export const REMINDER_REPEAT_HOURS = 24;

export const JE_STAGE_STATUSES = JE_STAGE;

/** When is reminder number `number` (1-based) due, for a reminder series anchored at `anchor`? */
export function reminderDueAt(anchor, number) {
  const i = number - 1;
  const last = REMINDER_OFFSETS_HOURS.length - 1;
  const hours = i <= last
    ? REMINDER_OFFSETS_HOURS[i]
    : REMINDER_OFFSETS_HOURS[last] + (i - last) * REMINDER_REPEAT_HOURS;
  return new Date(anchor.getTime() + hours * HOUR);
}

// ---- row loaders -------------------------------------------------------------------
async function loadTicketBrief(connection, ticketId) {
  const [rows] = await connection.query(
    `SELECT t.id, t.title, t.department, t.campus, t.landmark, t.status, t.applicant_id, t.assigned_je_id,
            t.assigned_ae_id, t.current_desk_user_id, t.is_mock
       FROM tickets t WHERE t.id = ?`,
    [ticketId]
  );
  return rows[0] ?? null;
}

async function loadUser(connection, id) {
  if (id == null) return null;
  const [rows] = await connection.query(
    'SELECT id, name, email, role FROM users WHERE id = ? AND is_active = TRUE', [id]);
  return rows[0] ?? null;
}

// ---- primitives ------------------------------------------------------------------------
/** (Re)starts the JE reminder series; the first row is the instant notice. */
const remindJe = (connection, { ticketId, je, email, now }) => startReminders(connection, {
  ticketId, user: je, email, stopStatuses: JE_STAGE_STATUSES, anchor: now, firstDueAt: reminderDueAt(now, 1),
});


// Applicant mail is for four events only; internal stage movement is never mailed (R9).
const APPLICANT_EVENT_FOR_STATUS = Object.freeze({
  [STATUS.DENIED]: EVENT.REJECTED,
  [STATUS.CLOSED]: EVENT.CLOSED,
  [STATUS.WORK_COMPLETED]: EVENT.RESOLVED,
});

async function notifyApplicant(connection, { ticketId, applicantId, event, now }) {
  const applicant = await loadUser(connection, applicantId);
  return queueFor(connection, {
    ticketId, user: applicant, kind: 'APPLICANT', event, email: applicantEventEmail(ticketId, event), now,
  });
}

/** The applicant is told when a ticket they raised ends up rejected, resolved or closed. */
export async function notifyApplicantStatus(connection, { ticketId, applicantId, fromStatus = null, toStatus, now = new Date() }) {
  const event = APPLICANT_EVENT_FOR_STATUS[toStatus];
  if (!event || fromStatus === toStatus) return null;
  return notifyApplicant(connection, { ticketId, applicantId, event, now });
}

// ---- flows -------------------------------------------------------------------------------

/** Ticket just raised. `assignment` = result of services/assignment.assignTicket. */
export async function notifyTicketCreated(connection, { ticketId, assignment, now = new Date() }) {
  const t = await loadTicketBrief(connection, ticketId);
  if (t.is_mock) return; // Sysadmin test ticket: no mail, no reminders
  const owner = assignment.deskUser;
  if (assignment.status === STATUS.ASSIGNED_TO_JE) {
    await remindJe(connection, { ticketId, je: owner, email: jeAssignedEmail(t), now });
  } else {
    await queueFor(connection, {
      ticketId, user: owner, event: EVENT.ARRIVAL, email: arrivalEmail({ ticketId, title: t.title, unassigned: true }), now,
    });
  }
  await notifyApplicant(connection, { ticketId, applicantId: t.applicant_id, event: EVENT.RECEIVED, now });
}

/** A desk action or JE report moved the ticket (called after the row was updated). */
export async function notifyTransition(connection, {
  ticketId, fromStatus, toStatus, action, toDesk = null, nextDeskUser = null,
  actor, message = null, now = new Date(),
}) {
  const t = await loadTicketBrief(connection, ticketId);
  if (t.is_mock) return;
  await cancelReminders(connection, ticketId);

  if (action === ACTION.ASSIGN_JE) {
    await remindJe(connection, { ticketId, je: nextDeskUser, email: jeAssignedEmail(t), now });
  } else if (action === ACTION.REQUEST_CHANGES) {
    const email = changesRequestedEmail({ ticketId, fromDesk: actor.desk, message });
    if (toDesk === 'JE') {
      await remindJe(connection, { ticketId, je: nextDeskUser, email, now });
    } else {
      await queueFor(connection, { ticketId, user: nextDeskUser, event: EVENT.ARRIVAL, email, now });
    }
  } else if (action === ACTION.FORWARD || action === ACTION.SUBMIT_REPORT) {
    await queueFor(connection, {
      ticketId, user: nextDeskUser, event: EVENT.ARRIVAL, email: arrivalEmail({ ticketId, title: t.title }), now,
    });
  } else if (action === ACTION.APPROVE || action === ACTION.REJECT) {
    // The outcome goes to the JE who did the site work; the remark stays in the portal.
    const approved = action === ACTION.APPROVE;
    await queueFor(connection, {
      ticketId, user: await loadUser(connection, t.assigned_je_id),
      event: approved ? EVENT.APPROVED : EVENT.REJECTED_JE, email: jeOutcomeEmail({ ticketId, approved }), now,
    });
  }

  await notifyApplicantStatus(connection, { ticketId, applicantId: t.applicant_id, fromStatus, toStatus, now });
}

/**
 * Tender / award / completion / closure. The applicant hears about resolved and
 * closed; a ticket the applicant sends back goes to the JE with their comment.
 * Nobody else is mailed for these moves.
 */
export async function notifyPostApproval(connection, { ticketId, fromStatus, toStatus, message = null, now = new Date() }) {
  const t = await loadTicketBrief(connection, ticketId);
  if (t.is_mock) return;
  await cancelReminders(connection, ticketId);

  const sentBack = fromStatus === STATUS.WORK_COMPLETED && toStatus !== STATUS.CLOSED;
  if (sentBack) {
    const je = await loadUser(connection, t.assigned_je_id);
    const email = jeSentBackEmail({ ticketId, comment: message });
    if (JE_STAGE_STATUSES.includes(toStatus)) {
      // Back on the inspection desk: the JE is reminded again, like any ticket waiting for their report.
      await remindJe(connection, { ticketId, je, email, now });
    } else {
      await queueFor(connection, { ticketId, user: je, event: EVENT.APPLICANT_SENT_BACK, email, now });
    }
    return;
  }
  await notifyApplicantStatus(connection, { ticketId, applicantId: t.applicant_id, fromStatus, toStatus, now });
}

/**
 * The Sysadmin changed `assigned_je_id` (at any stage). The new JE hears it is theirs, the old JE that it
 * is gone. The reminder series restarts for the new JE only while the ticket is at a JE stage.
 * No mail when nothing changed. A first assignment (no old JE) mails once.
 */
export async function notifyJeChange(connection, { ticketId, oldJeId, newJeId, now = new Date() }) {
  if (oldJeId === newJeId) return;
  const t = await loadTicketBrief(connection, ticketId);
  if (!t || t.is_mock) return;
  await cancelReminders(connection, ticketId); // the old series belonged to the old JE

  const newJe = await loadUser(connection, newJeId);
  if (newJe) {
    if (JE_STAGE_STATUSES.includes(t.status)) {
      await remindJe(connection, { ticketId, je: newJe, email: jeAssignedEmail(t), now });
    } else {
      await queueFor(connection, { ticketId, user: newJe, event: EVENT.JE_REASSIGNED_TO, email: jeAssignedEmail(t), now });
    }
  }
  const oldJe = await loadUser(connection, oldJeId);
  if (oldJe && oldJe.id !== newJeId) {
    await queueFor(connection, { ticketId, user: oldJe, event: EVENT.JE_REASSIGNED_AWAY, email: jeReassignedAwayEmail(ticketId), now });
  }
}

/** SYSADMIN override: restart the right reminder series for wherever the ticket ended up. */
export async function notifyAdminOverride(connection, {
  ticketId, fromStatus, oldJeId = null, newHolder = null, now = new Date(),
}) {
  const t = await loadTicketBrief(connection, ticketId);
  if (t.is_mock) return;
  const jeChanged = t.assigned_je_id !== oldJeId;
  const statusChanged = t.status !== fromStatus;
  // Nothing about the JE or the stage moved (e.g. the same person picked again): leave the series running.
  if (jeChanged || statusChanged) await cancelReminders(connection, ticketId);

  if (jeChanged) {
    await notifyJeChange(connection, { ticketId, oldJeId, newJeId: t.assigned_je_id, now });
  } else if (statusChanged && JE_STAGE_STATUSES.includes(t.status)) {
    // The ticket was moved onto the JE desk without changing the JE.
    await remindJe(connection, { ticketId, je: await loadUser(connection, t.assigned_je_id), email: jeAssignedEmail(t), now });
  }

  if (t.status === STATUS.UNASSIGNED) {
    await queueFor(connection, {
      ticketId, user: await findDeskOwner(connection, t, 'AE'), event: EVENT.ARRIVAL,
      email: arrivalEmail({ ticketId, title: t.title, unassigned: true }), now,
    });
  } else if (newHolder && t.current_desk_user_id === newHolder.id && !JE_STAGE_STATUSES.includes(t.status)) {
    // Approval desks: tell the new holder the ticket is theirs (the policy decides whether that desk is mailed).
    await queueFor(connection, {
      ticketId, user: newHolder, event: EVENT.ARRIVAL, email: arrivalEmail({ ticketId, title: t.title }), now,
    });
  }
  if (statusChanged) {
    await notifyApplicantStatus(connection, { ticketId, applicantId: t.applicant_id, fromStatus, toStatus: t.status, now });
  }
}
