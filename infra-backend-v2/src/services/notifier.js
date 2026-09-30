// ============================================================
//  NOTIFIER — the write side of the outbox (plan.md §3.4, §4 Phase 5).
//
//  Every function takes the caller's open transaction `connection`, so the
//  notification rows commit or roll back together with the workflow move that
//  caused them: no mail for a move that never happened, no move whose mail is
//  lost. Nothing here talks to SMTP -- cron/emailReminders.js sends.
//
//  JE reminder cadence (hours after the assignment): 0 (instant), 12, 24, 72,
//  then every 24 h. The AE is copied from the 4th reminder onwards (Q10).
//  Applicant mail = stage + portal link only (emailTemplates.applicantStageEmail).
// ============================================================
import { STATUS, ACTION, deskForStatus } from '../config/workflow.js';
import { findDeskOwner } from '../models/deskModel.js';
import * as notificationModel from '../models/notificationModel.js';
import { stageLabel } from './visibility.js';
import {
  applicantStageEmail, jeAssignmentEmail, unassignedEmail,
  changeRequestEmail, movementEmail, applicantVerifyEmail,
} from './emailTemplates.js';

const HOUR = 60 * 60 * 1000;
export const REMINDER_OFFSETS_HOURS = Object.freeze([0, 12, 24, 72]);
export const REMINDER_REPEAT_HOURS = 24;
export const AE_COPY_FROM = 4;

export const JE_STAGE_STATUSES = Object.freeze([STATUS.ASSIGNED_TO_JE, STATUS.RETURNED_TO_JE]);
export const AE_STAGE_STATUSES = Object.freeze([STATUS.UNASSIGNED]);
export const APPLICANT_STAGE_STATUSES = Object.freeze([STATUS.WORK_COMPLETED]);
const STOP_STATUSES = Object.freeze({ JE: JE_STAGE_STATUSES, AE: AE_STAGE_STATUSES, APPLICANT: APPLICANT_STAGE_STATUSES });

/** When is reminder number `number` (1-based) due, for a reminder series anchored at `anchor`? */
export function reminderDueAt(anchor, number) {
  const i = number - 1;
  const last = REMINDER_OFFSETS_HOURS.length - 1;
  const hours = i <= last
    ? REMINDER_OFFSETS_HOURS[i]
    : REMINDER_OFFSETS_HOURS[last] + (i - last) * REMINDER_REPEAT_HOURS;
  return new Date(anchor.getTime() + hours * HOUR);
}

export const copiesAe = (number) => number >= AE_COPY_FROM;

// ---- row loaders -------------------------------------------------------------------
async function loadTicketBrief(connection, ticketId) {
  const [rows] = await connection.query(
    `SELECT t.id, t.title, t.department, t.campus, t.category, t.priority, t.type, t.description,
            t.building, t.landmark, t.contact_phone, t.status, t.applicant_id, t.assigned_je_id,
            t.current_desk_user_id, t.is_mock,
            u.name AS applicant_name, u.email AS applicant_email, u.phone AS applicant_phone
       FROM tickets t JOIN users u ON u.id = t.applicant_id WHERE t.id = ?`,
    [ticketId]
  );
  return rows[0] ?? null;
}

async function loadUser(connection, id) {
  if (id == null) return null;
  const [rows] = await connection.query(
    'SELECT id, name, email FROM users WHERE id = ? AND is_active = TRUE', [id]);
  return rows[0] ?? null;
}

const assignmentFields = (t, recipient) => ({
  id: t.id, title: t.title, department: t.department, campus: t.campus, category: t.category,
  priority: t.priority, type: t.type, description: t.description, contactPhone: t.contact_phone,
  recipientName: recipient.name,
  reporterLine: `${t.applicant_name} (${t.applicant_email}${t.applicant_phone ? `, Phone: ${t.applicant_phone}` : ''})`,
  locationBlock: `${t.campus} campus${t.building ? `, ${t.building}` : ''} — ${t.landmark}`,
});

// ---- primitives ------------------------------------------------------------------------
export function queueEmail(connection, { ticketId, toUserId, audience = 'STAFF', email, now = new Date() }) {
  return notificationModel.insertEmail(connection, {
    ticketId, toUserId, audience, subject: email.subject, body: email.body, dueAt: now,
  });
}

/** Replaces any live reminder series of the ticket with a new one; `email` is the instant first notice. */
export async function startDeskReminders(connection, { ticketId, desk, user, email, now = new Date() }) {
  await notificationModel.cancelReminders(connection, ticketId);
  return notificationModel.insertReminder(connection, {
    ticketId, toUserId: user.id, desk, subject: email.subject, body: email.body,
    anchor: now, dueAt: reminderDueAt(now, 1),
    stopStatuses: STOP_STATUSES[desk], audience: desk === 'APPLICANT' ? 'APPLICANT' : 'STAFF',
  });
}

export const stopReminders = (connection, ticketId) => notificationModel.cancelReminders(connection, ticketId);

/** Tell the applicant only when the STAGE (plain-words label) actually changed. */
export async function notifyApplicantStage(connection, { ticketId, applicantId, fromStatus = null, toStatus, now = new Date() }) {
  if (fromStatus !== null && stageLabel(fromStatus) === stageLabel(toStatus)) return null;
  return queueEmail(connection, {
    ticketId, toUserId: applicantId, audience: 'APPLICANT', email: applicantStageEmail(ticketId, toStatus), now,
  });
}

// ---- flows -------------------------------------------------------------------------------

/** Ticket just raised. `assignment` = result of services/assignment.assignTicket. */
export async function notifyTicketCreated(connection, { ticketId, assignment, now = new Date() }) {
  const t = await loadTicketBrief(connection, ticketId);
  if (t.is_mock) return; // Sysadmin test ticket: no mail, no reminders
  const owner = assignment.deskUser;
  if (assignment.status === STATUS.ASSIGNED_TO_JE) {
    await startDeskReminders(connection, {
      ticketId, desk: 'JE', user: owner, email: jeAssignmentEmail(assignmentFields(t, owner)), now,
    });
  } else {
    await startDeskReminders(connection, {
      ticketId, desk: 'AE', user: owner, email: unassignedEmail(assignmentFields(t, owner)), now,
    });
  }
  await notifyApplicantStage(connection, {
    ticketId, applicantId: t.applicant_id, toStatus: assignment.status, now,
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
    await startDeskReminders(connection, {
      ticketId, desk: 'JE', user: nextDeskUser,
      email: jeAssignmentEmail(assignmentFields(t, nextDeskUser)), now,
    });
  } else if (action === ACTION.REQUEST_CHANGES) {
    const email = changeRequestEmail({
      ticketId, title: t.title, recipientName: nextDeskUser.name, desk: toDesk,
      fromDesk: actor.desk, fromName: actor.name, message,
    });
    if (toDesk === 'JE') {
      await startDeskReminders(connection, { ticketId, desk: 'JE', user: nextDeskUser, email, now });
    } else {
      await queueEmail(connection, { ticketId, toUserId: nextDeskUser.id, email, now });
    }
  } else if (action === ACTION.FORWARD || action === ACTION.SUBMIT_REPORT) {
    await queueEmail(connection, {
      ticketId, toUserId: nextDeskUser.id, now,
      email: movementEmail({
        ticketId, title: t.title, recipientName: nextDeskUser.name, desk: toDesk,
        headline: action === ACTION.SUBMIT_REPORT
          ? 'Site report submitted — awaiting your review'
          : 'Awaiting your review',
      }),
    });
  } else if (action === ACTION.APPROVE || action === ACTION.REJECT) {
    // Outcome goes to the JE who did the site work; the remark stays in the portal.
    const je = await loadUser(connection, t.assigned_je_id);
    if (je) {
      await queueEmail(connection, {
        ticketId, toUserId: je.id, now,
        email: movementEmail({
          ticketId, title: t.title, recipientName: je.name, desk: 'JE',
          headline: action === ACTION.APPROVE ? 'Approved' : 'Rejected',
        }),
      });
    }
  }

  await notifyApplicantStage(connection, { ticketId, applicantId: t.applicant_id, fromStatus, toStatus, now });
}

/**
 * Tender / award / completion / closure: tell the JE and the AE, and the
 * applicant if the stage moved. WORK_COMPLETED instead starts the applicant's
 * verification reminders (instant, +12h, +24h, +72h, then daily until they answer).
 */
export async function notifyPostApproval(connection, { ticketId, fromStatus, toStatus, headline, now = new Date() }) {
  const t = await loadTicketBrief(connection, ticketId);
  if (t.is_mock) return;
  await stopReminders(connection, ticketId);
  const je = await loadUser(connection, t.assigned_je_id);
  const ae = await findDeskOwner(connection, t, 'AE');
  for (const [user, desk] of [[je, 'JE'], [ae, 'AE']]) {
    if (!user) continue;
    await queueEmail(connection, {
      ticketId, toUserId: user.id, now,
      email: movementEmail({ ticketId, title: t.title, recipientName: user.name, desk, headline }),
    });
  }
  if (toStatus === STATUS.WORK_COMPLETED) {
    const applicant = await loadUser(connection, t.applicant_id);
    if (applicant) {
      await startDeskReminders(connection, {
        ticketId, desk: 'APPLICANT', user: applicant, email: applicantVerifyEmail(ticketId), now,
      });
    }
    return;
  }
  await notifyApplicantStage(connection, { ticketId, applicantId: t.applicant_id, fromStatus, toStatus, now });
}

/** SYSADMIN override: restart the right reminder series for wherever the ticket ended up. */
export async function notifyAdminOverride(connection, { ticketId, fromStatus, newHolder = null, now = new Date() }) {
  const t = await loadTicketBrief(connection, ticketId);
  if (t.is_mock) return;
  await stopReminders(connection, ticketId);

  if (JE_STAGE_STATUSES.includes(t.status)) {
    const je = await loadUser(connection, t.assigned_je_id);
    if (je) {
      await startDeskReminders(connection, {
        ticketId, desk: 'JE', user: je,
        email: jeAssignmentEmail(assignmentFields(t, je)), now,
      });
    }
  } else if (t.status === STATUS.UNASSIGNED) {
    const ae = await findDeskOwner(connection, t, 'AE');
    if (ae) {
      await startDeskReminders(connection, {
        ticketId, desk: 'AE', user: ae, email: unassignedEmail(assignmentFields(t, ae)), now,
      });
    }
  } else if (newHolder && t.current_desk_user_id === newHolder.id) {
    // Approval desks (AE/SE/Dean/Director): tell the new holder the ticket is theirs.
    await queueEmail(connection, {
      ticketId, toUserId: newHolder.id, now,
      email: movementEmail({
        ticketId, title: t.title, recipientName: newHolder.name, desk: deskForStatus(t.status),
        headline: 'Awaiting your review',
      }),
    });
  }
  if (t.status !== fromStatus) {
    await notifyApplicantStage(connection, {
      ticketId, applicantId: t.applicant_id, fromStatus, toStatus: t.status, now,
    });
  }
}
