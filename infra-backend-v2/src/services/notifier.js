// ============================================================
//  NOTIFIER — the write side of the outbox (plan.md §3.4, Master plan section 5).
//
//  Every function takes the caller's open transaction `connection`, so the
//  notification rows commit or roll back together with the workflow move that
//  caused them: no mail for a move that never happened, no move whose mail is
//  lost. Nothing here talks to SMTP -- cron/emailReminders.js sends.
//
//  Who is mailed, and how often:
//    JE        instant: assigned, reassigned in or out, change request, approved, rejected, sent back by the
//              applicant. Recurring while the ticket waits on the JE: 0, 12, 24, 72 h, then daily.
//    AE        one instant mail when a ticket lands UNASSIGNED (they must pick a JE), one when asked to
//              confirm a resolve. No reminders. Weekly digest.
//    SE, Dean  weekly digest only.   Director: nothing.
//    Whoever raised the ticket: received, rejected, resolved (please confirm), closed. Daily while a
//              resolve awaits their answer, seven mails at most; then it closes by itself.
//  Test tickets and deleted tickets are never mailed.
// ============================================================
import { STATUS, ACTION, AUTO_CLOSE_DAYS } from '../config/workflow.js';
import { findDeskOwner } from '../models/deskModel.js';
import * as notificationModel from '../models/notificationModel.js';
import {
  applicantStageEmail, jeAssignmentEmail, unassignedEmail, jeReassignedAwayEmail,
  changeRequestEmail, movementEmail, resolvedConfirmEmail, autoClosedEmail,
} from './emailTemplates.js';

const HOUR = 60 * 60 * 1000;
export const REMINDER_OFFSETS_HOURS = Object.freeze([0, 12, 24, 72]);
export const REMINDER_REPEAT_HOURS = 24;

export const JE_STAGE_STATUSES = Object.freeze([STATUS.ASSIGNED_TO_JE, STATUS.RETURNED_TO_JE]);
export const APPLICANT_STAGE_STATUSES = Object.freeze([STATUS.WORK_COMPLETED]);
// Only these two desks ever get a recurring series.
const STOP_STATUSES = Object.freeze({ JE: JE_STAGE_STATUSES, APPLICANT: APPLICANT_STAGE_STATUSES });

/** The confirmer of a resolved ticket: the resolve mail at once, then one a day, at most AUTO_CLOSE_DAYS in all. */
export const CONFIRMER_REPEAT_HOURS = 24;
export const CONFIRMER_MAX_MAILS = AUTO_CLOSE_DAYS;

/**
 * When is reminder number `number` (1-based) due, for a series anchored at `anchor`?
 * JE: 0, 12, 24, 72 h, then every 24 h. APPLICANT (the confirmer): 0 h, then every 24 h.
 */
export function reminderDueAt(anchor, number, desk = 'JE') {
  if (desk === 'APPLICANT') return new Date(anchor.getTime() + (number - 1) * CONFIRMER_REPEAT_HOURS * HOUR);
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
    `SELECT t.id, t.title, t.department, t.campus, t.priority, t.type, t.description,
            t.landmark, t.contact_phone, t.status, t.applicant_id, t.assigned_je_id,
            t.current_desk_user_id, t.is_mock, t.created_at,
            u.name AS applicant_name, u.email AS applicant_email, u.phone AS applicant_phone
       FROM infra_tickets t JOIN infra_users u ON u.id = t.applicant_id WHERE t.id = ?`,
    [ticketId]
  );
  return rows[0] ?? null;
}

async function loadUser(connection, id) {
  if (id == null) return null;
  const [rows] = await connection.query(
    'SELECT id, name, email FROM infra_users WHERE id = ? AND is_active = TRUE', [id]);
  return rows[0] ?? null;
}

const ticketFields = (t) => ({
  id: t.id, title: t.title, department: t.department, campus: t.campus, priority: t.priority, type: t.type,
  landmark: t.landmark, applicantName: t.applicant_name, applicantPhone: t.applicant_phone, contactPhone: t.contact_phone,
  createdAt: t.created_at,
});

// ---- primitives ------------------------------------------------------------------------
export function queueEmail(connection, { ticketId, toUserId, audience = 'STAFF', email, now = new Date() }) {
  return notificationModel.insertEmail(connection, {
    ticketId, toUserId, audience, subject: email.subject, body: email.body, dueAt: now,
  });
}

/**
 * Replaces any live reminder series of the ticket with a new one; `email` is the instant first notice.
 * Only the JE and the confirmer (APPLICANT) are ever nagged: anything else is a programming error.
 */
export async function startDeskReminders(connection, { ticketId, desk, user, email, now = new Date() }) {
  if (desk !== 'JE' && desk !== 'APPLICANT') {
    throw new Error(`Recurring reminders are only for the JE and the confirmer, not ${desk}.`);
  }
  await notificationModel.cancelReminders(connection, ticketId);
  return notificationModel.insertReminder(connection, {
    ticketId, toUserId: user.id, desk, subject: email.subject, body: email.body,
    anchor: now, dueAt: reminderDueAt(now, 1, desk),
    stopStatuses: STOP_STATUSES[desk], audience: desk === 'APPLICANT' ? 'APPLICANT' : 'STAFF',
  });
}

export const stopReminders = (connection, ticketId) => notificationModel.cancelReminders(connection, ticketId);

// The person who raised the ticket hears about: received, rejected, closed. Nothing in between.
const APPLICANT_MAIL_STATUSES = Object.freeze([STATUS.DENIED, STATUS.CLOSED]);

/** Tell the person who raised the ticket, only for rejected and closed (received is sent at creation). */
export async function notifyApplicantStage(connection, { ticketId, applicantId, fromStatus = null, toStatus, now = new Date() }) {
  if (!APPLICANT_MAIL_STATUSES.includes(toStatus) || fromStatus === toStatus) return null;
  const t = await loadTicketBrief(connection, ticketId);
  return queueEmail(connection, {
    ticketId, toUserId: applicantId, audience: 'APPLICANT', email: applicantStageEmail(ticketId, toStatus, t?.title ?? null), now,
  });
}

// ---- flows -------------------------------------------------------------------------------

/**
 * The JE of a ticket changed (assigned, reassigned by the AE or the Sysadmin). The old JE hears "reassigned, no
 * action needed" (skipped when there was none or it is the same person). The new JE gets the assignment mail
 * and, when the ticket is waiting on the JE, a reminder series.
 */
export async function notifyJeChanged(connection, { ticketId, oldJeId = null, newJeId, now = new Date() }) {
  const t = await loadTicketBrief(connection, ticketId);
  if (!t || t.is_mock) return;
  if (oldJeId != null && oldJeId !== newJeId) {
    const old = await loadUser(connection, oldJeId);
    if (old) {
      await queueEmail(connection, {
        ticketId, toUserId: old.id, now, email: jeReassignedAwayEmail({ ticketId, title: t.title, at: now }),
      });
    }
  }
  const je = await loadUser(connection, newJeId);
  if (!je || oldJeId === newJeId) return;
  const email = jeAssignmentEmail(ticketFields(t));
  if (JE_STAGE_STATUSES.includes(t.status)) {
    await startDeskReminders(connection, { ticketId, desk: 'JE', user: je, email, now });
  } else {
    await queueEmail(connection, { ticketId, toUserId: je.id, email, now });
  }
}

/** Ticket just raised. `assignment` = result of services/assignment.assignTicket. */
export async function notifyTicketCreated(connection, { ticketId, assignment, now = new Date() }) {
  const t = await loadTicketBrief(connection, ticketId);
  if (t.is_mock) return; // Sysadmin test ticket: no mail, no reminders
  const owner = assignment.deskUser;
  if (assignment.status === STATUS.ASSIGNED_TO_JE) {
    await startDeskReminders(connection, {
      ticketId, desk: 'JE', user: owner, email: jeAssignmentEmail(ticketFields(t)), now,
    });
  } else {
    // The AE must pick a JE: one mail, no series.
    await queueEmail(connection, { ticketId, toUserId: owner.id, email: unassignedEmail(ticketFields(t)), now });
  }
  // "Received", whatever the first desk is.
  await queueEmail(connection, {
    ticketId, toUserId: t.applicant_id, audience: 'APPLICANT', now,
    email: applicantStageEmail(ticketId, STATUS.UNASSIGNED, t.title),
  });
}

/** A desk action or JE report moved the ticket (called after the row was updated). */
export async function notifyTransition(connection, {
  ticketId, fromStatus, toStatus, action, toDesk = null, nextDeskUser = null,
  actor, message = null, now = new Date(),
}) {
  const t = await loadTicketBrief(connection, ticketId);
  if (t.is_mock) return;
  await stopReminders(connection, ticketId);

  if (action === ACTION.ASSIGN_JE) {
    await notifyJeChanged(connection, { ticketId, oldJeId: null, newJeId: nextDeskUser.id, now });
  } else if (action === ACTION.REQUEST_CHANGES && toDesk === 'JE') {
    // Changes asked of the JE: the one desk that is mailed for this, and nagged until they answer.
    await startDeskReminders(connection, {
      ticketId, desk: 'JE', user: nextDeskUser, now,
      email: changeRequestEmail({ ticketId, title: t.title, fromDesk: actor.desk, message }),
    });
  } else if (action === ACTION.APPROVE || action === ACTION.REJECT) {
    // The outcome goes to the JE who did the site work; the remark stays in the portal.
    const je = await loadUser(connection, t.assigned_je_id);
    if (je) {
      await queueEmail(connection, {
        ticketId, toUserId: je.id, now,
        email: movementEmail({
          ticketId, title: t.title, desk: 'JE', headline: action === ACTION.APPROVE ? 'Approved' : 'Rejected', at: now,
        }),
      });
    }
  }
  // Forwards, reports and changes asked of AE, SE, Dean or Director send nothing: they have the desk board and the digest.

  await notifyApplicantStage(connection, { ticketId, applicantId: t.applicant_id, fromStatus, toStatus, now });
}

/**
 * The JE resolved the ticket. The confirmer (stored on the ticket) is told at once. The person who raised it
 * then gets one reminder a day until they answer; an AE confirmer (the JE raised it) gets this one mail only
 * and the item in the weekly digest. Tender steps (publish, evaluate, award) mail nobody.
 */
export async function notifyResolved(connection, { ticketId, confirmer, kind, autoCloseOn, now = new Date() }) {
  const t = await loadTicketBrief(connection, ticketId);
  if (t.is_mock) return;
  await stopReminders(connection, ticketId);
  const forApplicant = confirmer.id === t.applicant_id;
  const email = resolvedConfirmEmail({ ticketId, title: t.title, kind, autoCloseOn, forAe: !forApplicant });
  if (forApplicant) {
    await startDeskReminders(connection, { ticketId, desk: 'APPLICANT', user: confirmer, email, now });
  } else {
    await queueEmail(connection, { ticketId, toUserId: confirmer.id, email, now });
  }
}

/** The confirmer closed the ticket or sent it back. */
export async function notifyConfirmation(connection, { ticketId, actorId, accepted, toStatus, now = new Date() }) {
  const t = await loadTicketBrief(connection, ticketId);
  if (t.is_mock) return;
  await stopReminders(connection, ticketId);
  if (accepted) {
    // The person who raised it is told it is closed; an AE confirmer does not need a mail for their own click.
    if (actorId === t.applicant_id) {
      await notifyApplicantStage(connection, { ticketId, applicantId: t.applicant_id, toStatus: STATUS.CLOSED, now });
    }
    return;
  }
  // Sent back: the JE hears about it at once, and nags start again if the ticket is back at a JE stage.
  const je = await loadUser(connection, t.assigned_je_id);
  if (!je) return;
  const email = movementEmail({
    ticketId, title: t.title, desk: 'JE', headline: 'Sent back by the applicant', at: now,
  });
  if (JE_STAGE_STATUSES.includes(toStatus)) {
    await startDeskReminders(connection, { ticketId, desk: 'JE', user: je, email, now });
  } else {
    await queueEmail(connection, { ticketId, toUserId: je.id, email, now });
  }
}

/** A resolved ticket nobody answered within AUTO_CLOSE_DAYS closed itself. */
export async function notifyAutoClosed(connection, { ticketId, confirmerId, resolvedAt, now = new Date() }) {
  const t = await loadTicketBrief(connection, ticketId);
  if (t.is_mock) return;
  await stopReminders(connection, ticketId);
  if (confirmerId == null) return;
  await queueEmail(connection, {
    ticketId, toUserId: confirmerId, audience: confirmerId === t.applicant_id ? 'APPLICANT' : 'STAFF', now,
    email: autoClosedEmail({ ticketId, title: t.title, resolvedAt, days: AUTO_CLOSE_DAYS }),
  });
}

/**
 * SYSADMIN override: restart the right reminder series for wherever the ticket ended up.
 * `previousJeId` = the JE before the override (null when none): when it differs from the current one, the
 * old JE is told and the new JE gets the assignment (see notifyJeChanged).
 */
export async function notifyAdminOverride(connection, { ticketId, fromStatus, previousJeId = null, now = new Date() }) {
  const t = await loadTicketBrief(connection, ticketId);
  if (t.is_mock) return;
  await stopReminders(connection, ticketId);

  const jeChanged = t.assigned_je_id != null && t.assigned_je_id !== previousJeId;
  if (jeChanged) {
    await notifyJeChanged(connection, { ticketId, oldJeId: previousJeId, newJeId: t.assigned_je_id, now });
  } else if (JE_STAGE_STATUSES.includes(t.status)) {
    const je = await loadUser(connection, t.assigned_je_id);
    if (je) {
      await startDeskReminders(connection, { ticketId, desk: 'JE', user: je, email: jeAssignmentEmail(ticketFields(t)), now });
    }
  } else if (t.status === STATUS.UNASSIGNED) {
    // One mail to the AE, no series.
    const ae = await findDeskOwner(connection, t, 'AE');
    if (ae) await queueEmail(connection, { ticketId, toUserId: ae.id, email: unassignedEmail(ticketFields(t)), now });
  }
  // Approval desks (AE, SE, Dean, Director) are not mailed: the desk board and the digest show the ticket.

  if (t.status !== fromStatus) {
    await notifyApplicantStage(connection, {
      ticketId, applicantId: t.applicant_id, fromStatus, toStatus: t.status, now,
    });
  }
}
