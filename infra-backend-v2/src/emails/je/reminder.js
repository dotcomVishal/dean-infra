import { base } from '../_facts.js';

export const subject = (d) => `Reminder ${d.number}: report pending for ${d.hours} hours`;
export const content = (d) => ({
  heading: 'Your report is pending',
  name: d.name,
  paragraphs: [`The inspection report for ${d.ref} has not been submitted yet. The ticket has been on your desk for ${d.hours} hours.`],
  facts: [...base(d), ['Pending for', `${d.hours} hours`]],
  after: [`Please submit the report with the estimate on the portal. This is reminder ${d.number}. Reminders continue until the report is submitted.`],
  button: { label: 'Submit report', href: d.link },
});
