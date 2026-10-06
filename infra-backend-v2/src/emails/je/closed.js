import { base } from '../_facts.js';

export const subject = () => 'Closed by the applicant';
export const content = (d) => ({
  heading: 'The applicant has closed the ticket',
  name: d.name,
  paragraphs: [`The applicant has confirmed that the work on ${d.ref} is complete. The ticket is now closed.`],
  facts: base(d),
  after: ['No further action is required from you. The full record remains available on the portal.'],
  button: { label: 'Open ticket', href: d.link },
});
