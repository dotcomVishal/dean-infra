import { base } from '../_facts.js';

export const subject = () => 'Not approved';
export const content = (d) => ({
  heading: 'The proposal was not approved',
  name: d.name,
  paragraphs: [`The report and estimate for ${d.ref} have not been approved, and the ticket has been closed as rejected.`],
  facts: base(d),
  after: ['No further action is required from you. Any remark recorded with the decision is on the ticket page.'],
  button: { label: 'Open ticket', href: d.link },
});
