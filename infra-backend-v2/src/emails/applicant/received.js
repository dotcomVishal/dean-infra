import { base } from '../_facts.js';

export const subject = () => 'Request received';
export const content = (d) => ({
  heading: 'We have received your request',
  name: d.name,
  paragraphs: [`Your maintenance request has been registered with the ticket number ${d.ref}. Please quote this number in any communication about it.`],
  facts: base(d),
  after: ['The request has been sent to the engineering section for inspection. You will be informed by e-mail when the work is completed, or if the request cannot be taken up. Its current stage is shown on the portal at any time.'],
  button: { label: 'View your request', href: d.link },
});
