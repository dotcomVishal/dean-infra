// Pure email builders: (plain data in) -> { subject, body }. No DB, no SMTP.
//
// Style (Master plan, section 5.3): plain text, subject under 70 characters starting `[Infra]`, a short body
// (no salutation, banner, bullet table or repeated field), the event's own time in IST, one link, one-line
// footer.
//
// Two audiences, two different contracts:
//   - Applicant builders take ONLY the ticket id, the applicant's own title, a status and dates. They have no
//     parameter that could carry a staff name, an amount or a remark, so an applicant mail cannot leak one:
//     redaction by construction, not by filtering.
//   - Staff mails may name people and quote the request; they go to people who may see that.
import { stageLabel } from './visibility.js';

export const SUBJECT_PREFIX = '[Infra]';
export const FOOTER = 'Deanery of Infrastructure (automated message)';

export const portalUrl = () => process.env.FRONTEND_URL || 'http://localhost:5173';
export const ticketRef = (id) => `#TKT-${String(id).padStart(4, '0')}`;

/** Where a desk should click to act on a ticket. */
export function linkForDesk(desk, ticketId) {
  const base = portalUrl();
  switch (desk) {
    case 'JE':         return `${base}/je/ticket/${ticketId}`;
    case 'AE': case 'SE': case 'DEAN': case 'DIRECTOR': return `${base}/approvals`;
    default:           return `${base}/ticket/${ticketId}`;
  }
}

// ---- time: always IST, never the server's zone -------------------------------------------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function istParts(d) {
  // IST is UTC+5:30 with no daylight saving: shift the instant, then read it as UTC.
  const t = new Date(new Date(d).getTime() + 330 * 60 * 1000);
  return {
    day: String(t.getUTCDate()).padStart(2, '0'), mon: MONTHS[t.getUTCMonth()], year: t.getUTCFullYear(),
    hh: String(t.getUTCHours()).padStart(2, '0'), mm: String(t.getUTCMinutes()).padStart(2, '0'),
  };
}
/** "30 Sep 2026 14:10" */
export const fmtIst = (d) => { const p = istParts(d); return `${p.day} ${p.mon} ${p.year} ${p.hh}:${p.mm}`; };
/** "30 Sep 2026" */
export const fmtDay = (d) => { const p = istParts(d); return `${p.day} ${p.mon} ${p.year}`; };

const mail = (subject, lines) => ({ subject: `${SUBJECT_PREFIX} ${subject}`, body: `${lines.filter((l) => l !== null && l !== undefined).join('\n')}\n\n${FOOTER}` });
const titled = (id, title) => `${ticketRef(id)} ${title}`;
const cap = (s) => (s ? s[0] + s.slice(1).toLowerCase() : s);

// ---- applicant (and whoever raised the ticket): id, own title, status, dates only ----------
/** Used only for: received, rejected, closed. */
export function applicantStageEmail(ticketId, status, title = null) {
  const stage = stageLabel(status);
  const word = status === 'CLOSED' ? 'closed' : status === 'DENIED' ? 'rejected' : 'received';
  return mail(`${ticketRef(ticketId)} ${word}`, [
    title ? titled(ticketId, title) : ticketRef(ticketId),
    `Status: ${stage}.`,
    `${portalUrl()}/ticket/${ticketId}`,
  ]);
}

/**
 * A resolved ticket waits for its confirmer: the person who raised it, or the AE when the JE raised it.
 * A cancelled tender is told in one line.
 */
export function resolvedConfirmEmail({ ticketId, title, kind, autoCloseOn, number = 1, forAe = false }) {
  const cancelled = kind === 'TENDER_CANCELLED';
  const what = cancelled
    ? 'The tender was cancelled. Open it to acknowledge and close; raise a new ticket for a new tender.'
    : forAe
      ? 'Resolved by the JE who raised it. Open it to close it, or send it back with a comment.'
      : 'Open it to close it, or send it back with a comment if the problem remains.';
  return mail(`${number > 1 ? `Reminder ${number}: ` : ''}${ticketRef(ticketId)} resolved: please confirm`, [
    `${forAe ? titled(ticketId, title) : `Your ticket ${titled(ticketId, `"${title}"`)}`} is marked resolved.`,
    what,
    `If you do not answer, it closes automatically on ${fmtDay(autoCloseOn)}.`,
    forAe ? linkForDesk('AE', ticketId) : `${portalUrl()}/ticket/${ticketId}`,
  ]);
}

/** Nobody answered within the window. */
export function autoClosedEmail({ ticketId, title, resolvedAt, days }) {
  return mail(`${ticketRef(ticketId)} closed automatically`, [
    `Your ticket ${titled(ticketId, `"${title}"`)} was marked resolved on ${fmtDay(resolvedAt)} and has been closed after ${days} days without a response.`,
    `If the problem remains, raise a new ticket: ${portalUrl()}/raise`,
  ]);
}

// ---- staff -----------------------------------------------------------------------------------

function raisedBy(t, at) {
  const who = [t.applicantName, t.applicantPhone || t.contactPhone].filter(Boolean).join(', ');
  return `Raised by ${who}, on ${fmtIst(at)}`;
}
const where = (t) => [`${cap(t.campus)} campus`, t.department, `Priority ${cap(t.priority ?? 'NORMAL')}`].filter(Boolean).join(', ');

/** The JE gets the ticket. `t.createdAt` is when it was raised. */
export function jeAssignmentEmail(t) {
  return mail(`${ticketRef(t.id)} assigned to you`, [
    titled(t.id, t.title),
    where(t),
    t.landmark ? `Landmark: ${t.landmark}` : null,
    raisedBy(t, t.createdAt),
    `Action: ${t.type === 'non-recurring' ? 'inspect the site and submit your proposal.' : 'inspect the site and submit your report.'}`,
    linkForDesk('JE', t.id),
  ]);
}

/** No JE is free: the AE picks one. One mail, no reminder series. */
export function unassignedEmail(t) {
  return mail(`${ticketRef(t.id)} needs a JE`, [
    titled(t.id, t.title),
    `No JE is free for ${t.department}, ${cap(t.campus)} campus. Choose one.`,
    raisedBy(t, t.createdAt),
    linkForDesk('AE', t.id),
  ]);
}

/** The JE who had the ticket no longer does. */
export function jeReassignedAwayEmail({ ticketId, title, at }) {
  return mail(`${ticketRef(ticketId)} reassigned to another JE`, [
    titled(ticketId, title),
    `Reassigned on ${fmtIst(at)}. No action needed from you.`,
  ]);
}

/** Changes requested of the JE (the only desk that is mailed for a change request). */
export function changeRequestEmail({ ticketId, title, fromDesk, message }) {
  return mail(`${ticketRef(ticketId)} changes requested by ${fromDesk}`, [
    titled(ticketId, title),
    `${fromDesk} message: "${message}"`,
    'Action: update your report and resubmit.',
    linkForDesk('JE', ticketId),
  ]);
}

/** One line to the JE: approved, rejected, or sent back by the applicant. No remark text: the portal holds that. */
export function movementEmail({ ticketId, title, desk, headline, at = null }) {
  return mail(`${ticketRef(ticketId)} ${headline.toLowerCase()}`, [
    titled(ticketId, title),
    at ? `${headline} on ${fmtIst(at)}.` : `${headline}.`,
    linkForDesk(desk, ticketId),
  ]);
}

/** A JE reminder (number 2 onwards). `since` is when the ticket reached the JE. */
export function reminderEmail({ ticketId, title, number, hoursPending, since }) {
  return mail(`Reminder ${number}: ${ticketRef(ticketId)} pending ${hoursPending} h`, [
    titled(ticketId, title),
    `Pending with you since ${fmtIst(since)}.`,
    linkForDesk('JE', ticketId),
  ]);
}

/**
 * Weekly summary for an AE, SE or Dean: what sits at their desk, oldest first, plus counts.
 * `rows` = [{ id, title, days }]; `counts` = { confirm, withJes, awaitingApplicant, sentBack } (AE only, may be null).
 */
export function weeklyDigestEmail({ roleLabel, scopeLabel, rows, confirm = 0, counts = null }) {
  const n = rows.length;
  const idW = Math.max(...rows.map((r) => ticketRef(r.id).length), 0);
  const lines = rows.slice(0, 20).map((r) => {
    const title = r.title.length > 28 ? `${r.title.slice(0, 27)}…` : r.title;
    return `${ticketRef(r.id).padEnd(idW)} ${title.padEnd(28)} ${r.days} ${r.days === 1 ? 'day' : 'days'}`;
  });
  if (rows.length > 20) lines.push(`and ${rows.length - 20} more`);
  const extra = [];
  if (confirm > 0) extra.push(`Waiting for your confirmation: ${confirm}.`);
  if (counts) {
    extra.push(`In your scope: ${counts.withJes} with JEs, ${counts.awaitingApplicant} awaiting the applicant, ${counts.sentBack} sent back.`);
  }
  return mail(`Weekly summary: ${n} ticket${n === 1 ? '' : 's'} at your desk`, [
    `At your desk (${roleLabel}${scopeLabel ? `, ${scopeLabel}` : ''}), oldest first:`,
    ...lines,
    ...extra,
    `${portalUrl()}/approvals`,
  ]);
}
