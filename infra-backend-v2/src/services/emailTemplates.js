// Mail building: (template name, plain data) -> { subject, body, html }. No DB, no SMTP.
//
// Each mail is one file under src/emails/ (wording) rendered by src/emails/layout.js (look).
// Rules, enforced by test/unit/email-templates.test.mjs:
//   - subject "[Infra] TKT-0042: <event>", at most 70 characters
//   - HTML and plain-text parts carry the same words, one link target, signature and footer
//   - body text at most 120 words, no emoji, no exclamation marks
//   - every value put into HTML is escaped
//
// Two audiences, two contracts:
//   - applicantEventEmail() hands a template ONLY { id, title, name }. The applicant mail
//     cannot carry a staff name, an amount or a remark, whatever the caller passes
//     (redaction by construction, plan.md Q11).
//   - Staff mails may name the ticket and quote a change request; they go to
//     people allowed to see that (visibility matrix).
import { EVENT } from './emailPolicy.js';
import { TEMPLATES } from '../emails/index.js';
import { render } from '../emails/layout.js';
import { SIGNATURE, portalUrl, ticketRef, ticketLink } from '../emails/common.js';

export { SIGNATURE, portalUrl, ticketRef, ticketLink };

export const subjectFor = (ticketId, what) => `[Infra] ${ticketRef(ticketId)}: ${what}`.slice(0, 70);

/**
 * @param {string} name  a key of TEMPLATES, such as 'je/assigned'
 * @param {object} data  { id, name, title, ... }: what that mail file reads
 */
export function build(name, data) {
  const mod = TEMPLATES[name];
  if (!mod) throw new Error(`No mail template ${name}`);
  const d = { ...data, ref: data.id != null ? ticketRef(data.id) : undefined, link: data.link ?? (data.id != null ? ticketLink(data.id) : portalUrl()) };
  const subject = mod.fullSubject ? mod.fullSubject(d) : subjectFor(d.id, mod.subject(d));
  return { subject, ...render(mod.content(d)) };
}

const APPLICANT_TEMPLATE = Object.freeze({
  [EVENT.RECEIVED]: 'applicant/received',
  [EVENT.RESOLVED]: 'applicant/resolved',
  [EVENT.REJECTED]: 'applicant/rejected',
  [EVENT.CLOSED]: 'applicant/closed',
});

/** The only way to build an applicant mail. `ticket` = { id, title }, `name` = the applicant's own name. */
export function applicantEventEmail(event, { id, title, name }) {
  const template = APPLICANT_TEMPLATE[event];
  if (!template) throw new Error(`No applicant mail for event ${event}`);
  return build(template, { id, title, name });
}
