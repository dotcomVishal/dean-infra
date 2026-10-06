import { base } from '../_facts.js';

export const subject = () => 'Request not approved';
export const content = (d) => ({
  heading: 'Your request was not approved',
  name: d.name,
  paragraphs: [`Your request ${d.ref} has been reviewed and has not been approved. No work will be taken up under this ticket.`],
  facts: base(d),
  after: ['The record remains available on the portal. If the requirement still stands, you may raise a new request with additional details.'],
  button: { label: 'View your request', href: d.link },
});
