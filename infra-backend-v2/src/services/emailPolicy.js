// ============================================================
//  E-MAIL POLICY: who gets which mail. The only place that decides.
//
//  Every enqueue goes through queueFor() / startReminders(), which consult
//  this table. Changing a rule later is a one-line edit here.
//
//    JE                    instant event mail, recurring reminders
//    AE, SE, Dean          ONE mail when a ticket arrives on their desk (never
//                          repeated), plus the weekly digest
//    Clerical, Accountant  weekly digest only
//    Director, Sysadmin    nothing automated
//    Applicant (creator)   received / resolved / rejected / closed only
// ============================================================
import * as notificationModel from '../models/notificationModel.js';

export const EVENT = Object.freeze({
  // JE
  JE_ASSIGNED: 'JE_ASSIGNED',
  JE_REASSIGNED_TO: 'JE_REASSIGNED_TO',
  JE_REASSIGNED_AWAY: 'JE_REASSIGNED_AWAY',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  APPROVED: 'APPROVED',
  REJECTED_JE: 'REJECTED_JE',
  APPLICANT_SENT_BACK: 'APPLICANT_SENT_BACK',
  // AE / SE / Dean: a ticket landed on the desk
  ARRIVAL: 'ARRIVAL',
  // Applicant (ticket creator, whatever their role)
  RECEIVED: 'RECEIVED',
  RESOLVED: 'RESOLVED',
  REJECTED: 'REJECTED',
  CLOSED: 'CLOSED',
});

const JE_EVENTS = [
  EVENT.JE_ASSIGNED, EVENT.JE_REASSIGNED_TO, EVENT.JE_REASSIGNED_AWAY, EVENT.CHANGES_REQUESTED,
  EVENT.APPROVED, EVENT.REJECTED_JE, EVENT.APPLICANT_SENT_BACK,
];
const APPLICANT_EVENTS = [EVENT.RECEIVED, EVENT.RESOLVED, EVENT.REJECTED, EVENT.CLOSED];
const none = Object.freeze({ events: new Set(), reminders: false, digest: false });

export const POLICY = Object.freeze({
  JE:         { events: new Set(JE_EVENTS), reminders: true, digest: false },
  AE:         { events: new Set([EVENT.ARRIVAL]), reminders: false, digest: true },
  SE:         { events: new Set([EVENT.ARRIVAL]), reminders: false, digest: true },
  DEAN:       { events: new Set([EVENT.ARRIVAL]), reminders: false, digest: true },
  CLERICAL:   { events: new Set(), reminders: false, digest: true },
  ACCOUNTANT: { events: new Set(), reminders: false, digest: true },
  DIRECTOR:   none,
  SYSADMIN:   none,
  APPLICANT:  { events: new Set(APPLICANT_EVENTS), reminders: false, digest: false },
});

/** Roles that receive the weekly digest. */
export const DIGEST_ROLES = Object.freeze(Object.keys(POLICY).filter((r) => POLICY[r].digest));

/** May a recipient of this kind (a role, or 'APPLICANT') get a mail for this event? */
export const allows = (kind, event) => POLICY[kind]?.events.has(event) ?? false;
export const remindersAllowed = (role) => POLICY[role]?.reminders === true;

async function roleOf(connection, user) {
  if (user.role) return user.role;
  const [rows] = await connection.query('SELECT role FROM mnt_users WHERE id = ?', [user.id]);
  return rows[0]?.role ?? null;
}

/**
 * Queue one event mail if the policy allows it. `kind` is 'APPLICANT' for the
 * ticket creator, otherwise the recipient's role (looked up when not given).
 * @returns the notification id, or null when the policy says no mail.
 */
export async function queueFor(connection, { ticketId, user, kind, event, email, now = new Date() }) {
  if (!user) return null;
  const recipientKind = kind ?? (await roleOf(connection, user));
  if (!allows(recipientKind, event)) return null;
  return notificationModel.insertEmail(connection, {
    ticketId, toUserId: user.id, audience: recipientKind === 'APPLICANT' ? 'APPLICANT' : 'STAFF',
    subject: email.subject, body: email.body, dueAt: now,
  });
}

/**
 * Replace the ticket's reminder series. Only a JE is ever reminded; for anyone
 * else this only cancels the old series. `stopStatuses` = statuses during which
 * the reminders keep going.
 */
export async function startReminders(connection, { ticketId, user, email, stopStatuses, firstDueAt, anchor }) {
  await notificationModel.cancelReminders(connection, ticketId);
  const role = user ? await roleOf(connection, user) : null;
  if (!user || !remindersAllowed(role)) return null;
  return notificationModel.insertReminder(connection, {
    ticketId, toUserId: user.id, desk: 'JE', subject: email.subject, body: email.body,
    anchor, dueAt: firstDueAt, stopStatuses, audience: 'STAFF',
  });
}
