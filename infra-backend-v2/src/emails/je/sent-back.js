import { base } from '../_facts.js';
import { stageLabel } from '../labels.js';

export const subject = () => 'Sent back by the applicant';
export const content = (d) => ({
  heading: 'The applicant has sent the ticket back',
  name: d.name,
  paragraphs: [`The applicant has reported that the work on ${d.ref} is not complete, and has sent the ticket back with the note quoted below.`],
  facts: [...base(d), ['Current stage', stageLabel(d.status)]],
  quote: d.comment,
  after: [
    'Please review the note, attend to what is pending and take the ticket forward from the portal.',
    ...(d.inspection ? ['Reminders will be sent until your report is submitted.'] : []),
  ],
  button: { label: 'Open ticket', href: d.link },
});
