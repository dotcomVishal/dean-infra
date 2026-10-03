import type { TicketMessage } from '../components/ticket/types';
import { visibleDesks } from './ticketUi';

/** Readers of a message, printed on every message so nobody has to guess (plan §3.6). */
export const visibleToText = (m: Pick<TicketMessage, 'kind' | 'visible_from_rank'>) => {
  const desks = visibleDesks(Math.max(m.visible_from_rank, 1));
  return m.kind === 'PUBLIC_NOTE' ? ['Applicant', ...visibleDesks(1)].join(', ') : desks.join(', ');
};

/** The thread behind the open request: earlier requests it answers, the head, and replies to any of them. */
export function openThread(messages: TicketMessage[], openId: number | null | undefined) {
  if (!openId) return { head: null as TicketMessage | null, thread: [] as TicketMessage[] };
  const byId = new Map(messages.map((m) => [m.id, m]));
  const head = byId.get(openId) ?? null;
  if (!head) return { head: null, thread: [] };
  const chain: TicketMessage[] = [];
  for (let cur: TicketMessage | undefined = head; cur; cur = cur.in_reply_to ? byId.get(cur.in_reply_to) : undefined) {
    chain.unshift(cur);
  }
  const ids = new Set(chain.map((m) => m.id));
  const replies = messages.filter((m) => m.kind === 'REPLY' && m.in_reply_to != null && ids.has(m.in_reply_to));
  return { head, thread: [...chain, ...replies].sort((a, b) => a.id - b.id) };
}

