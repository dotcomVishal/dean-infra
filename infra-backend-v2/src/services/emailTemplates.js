// Pure email builders: (plain data in) -> { subject, body }. No DB, no SMTP.
//
// Plain text, short, one link. Rules (enforced by test/unit/email-templates.test.mjs):
//   - no "<", no "=====", no bullets, no emoji
//   - subject "[Infra] TKT-0042: <event>", at most 70 characters
//   - body at most 6 lines for an event mail, one link, a one-line signature
//   - no description text, no phone numbers, no applicant e-mail address
//
// Two audiences, two contracts:
//   - applicantEventEmail() takes ONLY (ticketId, event). It has no parameter
//     that could carry a staff name, an amount or a remark, so an applicant
//     mail cannot leak one (redaction by construction, plan.md Q11).
//   - Staff mails may name the ticket and quote a change request; they go to
//     people allowed to see that (visibility matrix).
import { EVENT } from './emailPolicy.js';

export const SIGNATURE = 'Deanery of Infrastructure, IIT Mandi';

export const portalUrl = () => process.env.FRONTEND_URL || 'http://localhost:5173';
export const ticketRef = (id) => `TKT-${String(id).padStart(4, '0')}`;
export const ticketLink = (id) => `${portalUrl()}/ticket/${id}`;

const subjectFor = (ticketId, what) => `[Infra] ${ticketRef(ticketId)}: ${what}`.slice(0, 70);
const oneLine = (text, max) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};
const campusName = (campus) => (campus ? `${String(campus)[0]}${String(campus).slice(1).toLowerCase()} campus` : '');
const compose = (...lines) => `${lines.filter((l) => l !== null && l !== undefined).join('\n')}\n\n${SIGNATURE}`;

// ---- JE ---------------------------------------------------------------------------------
/** New or reassigned-to JE: what to inspect, one link. `t` = { id, title, department, campus, landmark }. */
export function jeAssignedEmail(t) {
  return {
    subject: subjectFor(t.id, 'Assigned to you'),
    body: compose(
      `${ticketRef(t.id)}, ${oneLine(t.title, 80)}.`,
      `${t.department}, ${campusName(t.campus)}.${t.landmark ? ` ${oneLine(t.landmark, 80)}.` : ''}`,
      'Inspect and file your report:',
      ticketLink(t.id),
    ),
  };
}

export function jeReassignedAwayEmail(ticketId) {
  return {
    subject: subjectFor(ticketId, 'Reassigned'),
    body: compose(`${ticketRef(ticketId)} has been reassigned to another engineer. No action is needed from you.`),
  };
}

export function changesRequestedEmail({ ticketId, fromDesk, message }) {
  return {
    subject: subjectFor(ticketId, `Changes requested by ${fromDesk}`),
    body: compose(
      `${fromDesk} has returned ${ticketRef(ticketId)} for changes:`,
      `"${oneLine(message, 300)}"`,
      ticketLink(ticketId),
    ),
  };
}

/** Outcome for the JE who did the site work. The remark stays in the portal. */
export function jeOutcomeEmail({ ticketId, approved }) {
  return {
    subject: subjectFor(ticketId, approved ? 'Approved' : 'Rejected'),
    body: compose(`${ticketRef(ticketId)} was ${approved ? 'approved' : 'rejected'}.`, ticketLink(ticketId)),
  };
}

export function jeSentBackEmail({ ticketId, comment }) {
  return {
    subject: subjectFor(ticketId, 'Sent back by the applicant'),
    body: compose(
      `The applicant says the work on ${ticketRef(ticketId)} is not done:`,
      `"${oneLine(comment, 300)}"`,
      ticketLink(ticketId),
    ),
  };
}

/** Reminder number `number` (1 is the instant notice, which is jeAssignedEmail). */
export function jeReminderEmail({ ticketId, number, hoursPending }) {
  return {
    subject: subjectFor(ticketId, `Reminder ${number}, pending ${hoursPending} hours`),
    body: compose(`${ticketRef(ticketId)} is waiting for your report.`, ticketLink(ticketId)),
  };
}

// ---- AE / SE / Dean: one mail when a ticket lands on the desk --------------------------------------
export function arrivalEmail({ ticketId, title, unassigned = false }) {
  return {
    subject: subjectFor(ticketId, unassigned ? 'Needs a JE' : 'Awaiting your review'),
    body: compose(
      `${ticketRef(ticketId)}, ${oneLine(title, 80)}.`,
      unassigned ? 'No JE is available. Choose one on the portal:' : 'It is on your desk:',
      ticketLink(ticketId),
    ),
  };
}

// ---- applicant: event + portal link, nothing else ---------------------------------------------------------
const APPLICANT_COPY = Object.freeze({
  [EVENT.RECEIVED]: { what: 'Received', line: (r) => `We have received your ticket ${r}.` },
  [EVENT.RESOLVED]: { what: 'Resolved, please verify', line: (r) => `Your ticket ${r} has been marked resolved.\nClose it, or send it back with a comment:` },
  [EVENT.REJECTED]: { what: 'Rejected', line: (r) => `Your ticket ${r} was rejected.` },
  [EVENT.CLOSED]: { what: 'Closed', line: (r) => `Your ticket ${r} is closed.` },
});

export function applicantEventEmail(ticketId, event) {
  const copy = APPLICANT_COPY[event];
  if (!copy) throw new Error(`No applicant mail for event ${event}`);
  return {
    subject: subjectFor(ticketId, copy.what),
    body: compose(copy.line(ticketRef(ticketId)), ticketLink(ticketId)),
  };
}
