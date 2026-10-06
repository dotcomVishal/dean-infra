import { base } from '../_facts.js';

export const subject = () => 'Reassigned to another engineer';
export const content = (d) => ({
  heading: 'This ticket is no longer with you',
  name: d.name,
  paragraphs: [`${d.ref} has been reassigned to another engineer and is no longer on your desk.`],
  facts: base(d),
  after: ['No further action is required from you on this ticket, and reminders for it have stopped.'],
  button: null,
});
