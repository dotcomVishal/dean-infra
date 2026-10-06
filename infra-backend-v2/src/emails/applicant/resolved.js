import { base } from '../_facts.js';

export const subject = () => 'Work completed, please confirm';
export const content = (d) => ({
  heading: 'Please confirm that the work is complete',
  name: d.name,
  paragraphs: [`The engineer has reported that the work on your request ${d.ref} is complete.`],
  facts: base(d),
  after: [
    'Please check the work and record your response on the portal. If the work is satisfactory, confirm it and the ticket will be closed. If something is still pending, send the ticket back with a short note describing what remains.',
    'The ticket stays open until you respond.',
  ],
  button: { label: 'Confirm or send back', href: d.link },
});
