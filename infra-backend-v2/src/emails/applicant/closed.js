import { base } from '../_facts.js';

export const subject = () => 'Closed';
export const content = (d) => ({
  heading: 'Your request is closed',
  name: d.name,
  paragraphs: [`Your request ${d.ref} has been closed.`],
  facts: base(d),
  after: ['The record remains available on the portal for reference. For any new issue, including a recurrence of this one, please raise a new request.'],
  button: { label: 'View your request', href: d.link },
});
