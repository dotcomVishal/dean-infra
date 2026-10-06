import { base, place } from '../_facts.js';
import { inr } from '../labels.js';

export const subject = () => 'Awaiting your review';
export const content = (d) => ({
  heading: 'A ticket is awaiting your review',
  name: d.name,
  paragraphs: ['The following ticket has reached your desk and is waiting for your decision.'],
  facts: [...base(d), ...place(d).slice(0, 2), ['Estimate', inr(d.estimate)]],
  after: ["Please review the engineer's report and the estimate, and record your decision on the portal. This notice is sent once. The ticket also appears in your weekly summary until it is decided."],
  button: { label: 'Review ticket', href: d.link },
});
