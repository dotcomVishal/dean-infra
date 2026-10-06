import { base } from '../_facts.js';
import { deskName } from '../labels.js';

export const subject = (d) => `Returned by the ${deskName(d.fromDesk)} for changes`;
export const content = (d) => ({
  heading: 'Returned to you for changes',
  name: d.name,
  paragraphs: [`The ${deskName(d.fromDesk)} has returned the following ticket to your desk with the remark quoted below.`],
  facts: base(d),
  quote: d.message,
  after: [
    'Please address the remark and send the ticket forward again from the portal.',
    ...(d.toJe ? ['Reminders will continue until the revised report is submitted.'] : []),
  ],
  button: { label: 'Open ticket', href: d.link },
});
