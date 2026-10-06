import { base } from '../_facts.js';

export const subject = () => 'Approved';
export const content = (d) => ({
  heading: 'The proposal has been approved',
  name: d.name,
  paragraphs: [`The report and estimate for ${d.ref} have been approved.`],
  facts: base(d),
  after: ['The ticket is back with you for execution. Record each tender stage on the portal as it happens, and mark the ticket resolved once the work is complete. Any remark made with the approval is on the ticket page.'],
  button: { label: 'Open ticket', href: d.link },
});
