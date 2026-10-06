import { base, place } from '../_facts.js';
import { stageLabel } from '../labels.js';

export const subject = () => 'Transferred to you';
export const content = (d) => ({
  heading: 'A ticket has been transferred to you',
  name: d.name,
  paragraphs: ['You are now the engineer in charge of the following ticket. It was handled by another engineer until now.'],
  facts: [...base(d), ...place(d).slice(0, 2), ['Current stage', stageLabel(d.status)]],
  after: ['Please go through the record on the portal and take the ticket forward from its current stage.'],
  button: { label: 'Open ticket', href: d.link },
});
