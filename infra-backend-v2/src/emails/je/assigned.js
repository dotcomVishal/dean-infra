import { base, place } from '../_facts.js';

export const subject = () => 'Assigned to you for inspection';
export const content = (d) => ({
  heading: 'A request has been assigned to you',
  name: d.name,
  paragraphs: ['The following maintenance request has been assigned to you for inspection.'],
  facts: [...base(d), ...place(d)],
  after: ['Please inspect the site and submit your report with the estimate on the portal. Reminders are sent 12, 24 and 72 hours after assignment, and daily after that, until the report is submitted.'],
  button: { label: 'Open ticket', href: d.link },
});
