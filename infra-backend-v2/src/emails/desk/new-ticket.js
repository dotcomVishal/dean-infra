import { base, place } from '../_facts.js';

export const subject = () => 'New request in your area';
export const content = (d) => ({
  heading: 'A new request has been raised in your area',
  name: d.name,
  paragraphs: [`A maintenance request has been raised in your area and assigned automatically to ${d.jeName} for inspection.`],
  facts: [...base(d), ...place(d), ['Assigned to', d.jeName]],
  after: ['This message is for your information and needs no action now. The ticket will come to your desk when the engineer submits the report.'],
  button: { label: 'View ticket', href: d.link },
});
