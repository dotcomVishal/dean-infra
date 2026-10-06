import { base, place } from '../_facts.js';

export const subject = () => 'No engineer assigned, please assign';
export const content = (d) => ({
  heading: 'A request needs an engineer',
  name: d.name,
  paragraphs: ['The following maintenance request in your area does not have an engineer assigned to it.'],
  facts: [...base(d), ...place(d)],
  after: ['Please choose an engineer for it on the portal so that the inspection can begin. The request stays unassigned until you do.'],
  button: { label: 'Assign an engineer', href: d.link },
});
