// Pure email builders: (plain data in) -> { subject, body }. No DB, no SMTP.
//
// Two audiences, two different contracts:
//   - applicantStageEmail() takes ONLY (ticketId, status). It has no parameter
//     that could carry a staff name, an amount or a remark, so an applicant
//     mail cannot leak one -- redaction by construction, not by filtering
//     (plan.md Q11).
//   - Staff mails may name people and quote the request; they go to people
//     who are allowed to see that (visibility matrix).
import { stageLabel } from './visibility.js';

const FOOTER = 'Deanery of Infrastructure, IIT Mandi\nThis is an automated operational notification.';

export const portalUrl = () => process.env.FRONTEND_URL || 'http://localhost:5173';
export const ticketRef = (id) => `#TKT-${String(id).padStart(4, '0')}`;

/** Where a desk should click to act on a ticket. */
export function linkForDesk(desk, ticketId) {
  const base = portalUrl();
  switch (desk) {
    case 'JE':         return `${base}/je/ticket/${ticketId}`;
    case 'AE': case 'SE': case 'DEAN': case 'DIRECTOR': return `${base}/approvals`;
    case 'CLERICAL':   return `${base}/clerical`;
    case 'ACCOUNTANT': return `${base}/finance`;
    default:           return `${base}/ticket/${ticketId}`;
  }
}

// ---- applicant: stage + portal link, nothing else --------------------------------------
export function applicantStageEmail(ticketId, status) {
  const stage = stageLabel(status);
  return {
    subject: `[Deanery of Infrastructure] Ticket ${ticketRef(ticketId)}: ${stage}`,
    body: `Your ticket ${ticketRef(ticketId)} is now: ${stage}.

Track it on the portal:
${portalUrl()}/ticket/${ticketId}

${FOOTER}`,
  };
}

// ---- staff ---------------------------------------------------------------------------
const ist = () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

export function jeAssignmentEmail(t) {
  return {
    subject: `[Deanery of Infrastructure] New Ticket #${t.id} Assigned: ${t.title}`,
    body: `Dear ${t.recipientName},

A ticket has been assigned to you for inspection.

======================================================================
TICKET INFORMATION
======================================================================
• Ticket ID:      ${ticketRef(t.id)}
• Title:          ${t.title}
• Department:     ${t.department}
• Category:       ${t.category}
• Priority:       ${t.priority}
• Work Type:      ${t.type === 'non-recurring' ? 'Proposal' : 'Recurring'}
• Reported By:    ${t.reporterLine}
• Contact Phone:  ${t.contactPhone}
• Location:       ${t.locationBlock}
• Date & Time:    ${ist()}

======================================================================
DESCRIPTION
======================================================================
${t.description}

======================================================================
ACTION REQUIRED
======================================================================
Inspect the site, then submit your findings and estimate on the portal:

Open the ticket: ${linkForDesk('JE', t.id)}

${FOOTER}`,
  };
}

export function unassignedEmail(t) {
  return {
    subject: `[Deanery of Infrastructure] Ticket #${t.id} UNASSIGNED — no JE available: ${t.title}`,
    body: `Dear ${t.recipientName},

No JE is available for ${t.department} / ${t.campus} campus (all are busy or on leave). Choose a JE for this ticket.

======================================================================
TICKET INFORMATION
======================================================================
• Ticket ID:      ${ticketRef(t.id)}
• Title:          ${t.title}
• Department:     ${t.department}
• Category:       ${t.category}
• Priority:       ${t.priority}
• Reported By:    ${t.reporterLine}
• Contact Phone:  ${t.contactPhone}
• Location:       ${t.locationBlock}
• Date & Time:    ${ist()}

======================================================================
DESCRIPTION
======================================================================
${t.description}

======================================================================
ACTION REQUIRED
======================================================================
Choose a JE on the portal:

Open the ticket: ${linkForDesk('AE', t.id)}

${FOOTER}`,
  };
}

/** Change request addressed to a desk: carries the sender's name and message. */
export function changeRequestEmail({ ticketId, title, recipientName, desk, fromDesk, fromName, message }) {
  return {
    subject: `[Deanery of Infrastructure] Changes requested on Ticket #${ticketId}: ${title}`,
    body: `Dear ${recipientName},

${fromDesk} ${fromName} has requested changes on ticket ${ticketRef(ticketId)} (${title}).

Message:
${message}

Open the ticket:
${linkForDesk(desk, ticketId)}

${FOOTER}`,
  };
}

/** A ticket landed on a desk, or moved on. No remark text: the portal holds that. */
export function movementEmail({ ticketId, title, recipientName, desk, headline }) {
  return {
    subject: `[Deanery of Infrastructure] Ticket #${ticketId}: ${headline}`,
    body: `Dear ${recipientName},

Ticket ${ticketRef(ticketId)} (${title}): ${headline}.

Open the ticket:
${linkForDesk(desk, ticketId)}

${FOOTER}`,
  };
}

/** Reminder #2 onwards. `escalated` = the AE is copied (4th reminder onwards). */
export function reminderEmail({ ticketId, title, recipientName, desk, number, hoursPending, escalated }) {
  const what = desk === 'AE'
    ? 'This ticket still has no JE. Choose one on the portal.'
    : 'Submit your findings and estimate as soon as possible.';
  return {
    subject: `[ACTION REQUIRED] Reminder ${number} — Ticket #${ticketId}: ${title}`,
    body: `Dear ${recipientName},

This is reminder ${number} for ticket ${ticketRef(ticketId)} (${title}), pending at your desk for about ${hoursPending} hours.
${escalated ? '\nThe AE of this ticket is copied on this reminder.\n' : ''}
${what}
${linkForDesk(desk, ticketId)}

${FOOTER}`,
  };
}
