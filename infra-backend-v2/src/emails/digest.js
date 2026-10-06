import { ticketRef } from './common.js';

// Not a ticket mail: the subject carries no ticket number, and the link is the role's page.
export const fullSubject = (d) => `[Infra] Weekly summary, ${d.range}`;
export const subject = fullSubject;
export const content = (d) => {
  const oldest = d.oldest ?? [];
  const days = (n) => `${n} day${n === 1 ? '' : 's'}`;
  return {
    heading: `Weekly summary, ${d.range}`,
    name: d.name,
    paragraphs: [`This is the summary of your desk for the week of ${d.range}.`],
    facts: d.counts.map(([label, n]) => [label, String(n)]),
    wideFacts: true,
    table: oldest.length ? {
      title: 'Oldest pending',
      head: ['Ticket', 'Waiting (days)', 'Status'],
      rows: oldest.map((o) => [ticketRef(o.id), String(o.days), o.label]),
      text: oldest.map((o) => `${ticketRef(o.id)}, ${days(o.days)}, ${o.label}`),
    } : null,
    after: ['Open the portal to act on these.'],
    button: { label: 'Open the portal', href: d.link, plainLabel: 'Open the portal' },
  };
};
