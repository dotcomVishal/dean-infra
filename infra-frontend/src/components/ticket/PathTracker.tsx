import { useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { Check, X, CornerUpLeft, Circle } from 'lucide-react';
import type { AuditEntry, TicketDetail } from './types';
import { deskLabel, formatAge, hoursSince, STATUS_DESK } from '../../lib/ticketUi';
import { Card } from './Card';

type StepState = 'done' | 'current' | 'future' | 'returned' | 'rejected';
interface Step {
  key: string;
  label: string;
  sub?: string;
  date?: string;
  state: StepState;
  spent?: string;
}

// Movements that become a node on the path. Reminders, bills and admin noise do not.
const NODE_LABEL: Record<string, (a: AuditEntry) => string> = {
  CREATED: () => 'Raised',
  ASSIGNED: () => 'Assigned to JE',
  REASSIGNED: () => 'Reassigned',
  SUBMITTED: () => 'JE report filed',
  FORWARDED: (a) => (a.to_desk ? `Forwarded to ${deskLabel(a.to_desk)}` : 'Forwarded'),
  PASSED: (a) => (a.to_desk ? `Forwarded to ${deskLabel(a.to_desk)}` : 'Forwarded'),
  APPROVED: (a) => (a.from_desk ? `Approved by ${deskLabel(a.from_desk)}` : 'Approved'),
  CHANGES_REQUESTED: (a) => `${deskLabel(a.from_desk)} asked ${deskLabel(a.to_desk)} for changes`,
  RETURNED: () => 'Returned to JE',
  REJECTED: (a) => (a.from_desk ? `Rejected by ${deskLabel(a.from_desk)}` : 'Rejected'),
  DENIED: () => 'Rejected',
  TENDER_PUBLISHED: () => 'Tender published',
  WORK_AWARDED: () => 'Work awarded',
  WORK_COMPLETED: () => 'Work completed',
  CLOSED: () => 'Closed',
};
const STATE_OF: Record<string, StepState> = {
  CHANGES_REQUESTED: 'returned', RETURNED: 'returned', REJECTED: 'rejected', DENIED: 'rejected',
};

const CHAIN = ['JE', 'AE', 'SE', 'DEAN', 'DIRECTOR'];
const POST = [
  { key: 'tender', label: 'Tendering' },
  { key: 'work', label: 'Work in progress' },
  { key: 'closed', label: 'Closed' },
];

/** Steps still ahead of the ticket, drawn dashed. Desks past the current one are "if required": any of SE/Dean/Director may approve. */
function futureSteps(status: string, assignees?: TicketDetail['assignees']): Step[] {
  const out: Step[] = [];
  const push = (key: string, label: string, sub?: string) => out.push({ key: `f-${key}`, label, sub, state: 'future' });
  if (status === 'CLOSED' || status === 'DENIED') return out;

  const postIdx: Record<string, number> = { APPROVED_FOR_TENDERING: 0, TENDER_PUBLISHED: 1, WORK_IN_PROGRESS: 2 };
  if (status in postIdx) {
    POST.slice(postIdx[status] + 1).forEach((p) => push(p.key, p.label));
    return out;
  }
  const deskNow = STATUS_DESK[status];
  const fromIdx = status === 'UNASSIGNED' ? 0 : CHAIN.indexOf(deskNow) + 1;
  CHAIN.slice(fromIdx).forEach((d) => {
    const name = assignees?.[d as 'JE']?.name;
    const note = d === 'JE' || d === 'AE' ? undefined : 'if required';
    push(d, `${deskLabel(d)} desk`, [name, note].filter(Boolean).join(' · ') || undefined);
  });
  POST.forEach((p) => push(p.key, p.label));
  return out;
}

function buildSteps(ticket: TicketDetail, now = Date.now()): Step[] {
  const audit = ticket.audit_logs ?? [];
  const steps: Step[] = [];

  // The ticket is always "raised" even if the viewer's audit filter hid the CREATED row.
  if (!audit.some((a) => a.action === 'CREATED')) {
    steps.push({ key: 'raised', label: 'Raised', date: ticket.created_at, state: 'done' });
  }
  audit.forEach((a, i) => {
    const label = NODE_LABEL[a.action]?.(a);
    if (!label) return;
    steps.push({
      key: `a-${i}`, label,
      sub: a.actor_name ? a.actor_name : undefined,
      date: a.created_at,
      state: STATE_OF[a.action] ?? 'done',
    });
  });

  // "Time spent": from each node to the next one. The current desk shows its own age.
  steps.forEach((s, i) => {
    const end = steps[i + 1]?.date;
    if (s.date && end) s.spent = formatAge((new Date(end).getTime() - new Date(s.date).getTime()) / 36e5);
  });

  const terminal = ticket.status === 'CLOSED' || ticket.status === 'DENIED';
  if (!terminal) {
    const since = ticket.status_changed_at ?? steps[steps.length - 1]?.date ?? ticket.created_at;
    const desk = STATUS_DESK[ticket.status];
    steps.push({
      key: 'now',
      label: desk ? `${deskLabel(desk)} desk` : ticket.status === 'APPROVED_FOR_TENDERING' ? 'Tendering'
        : ticket.status === 'TENDER_PUBLISHED' ? 'Tender open' : 'Work in progress',
      sub: [ticket.assignees?.current?.name, `Here ${formatAge(hoursSince(since, now))}`].filter(Boolean).join(' · '),
      state: 'current',
    });
  }
  return [...steps, ...futureSteps(ticket.status, ticket.assignees)];
}

const NODE: Record<StepState, string> = {
  done: 'border-emerald-500 bg-emerald-500 text-white',
  current: 'border-blue-600 bg-blue-600 text-white shadow-lg shadow-blue-500/30 ring-4 ring-blue-500/15',
  returned: 'border-amber-500 bg-amber-500 text-white',
  rejected: 'border-rose-500 bg-rose-500 text-white',
  future: 'border-dashed border-slate-300 bg-transparent text-slate-300 dark:border-slate-600 dark:text-slate-600',
};

export default function PathTracker({ ticket }: { ticket: TicketDetail }) {
  const steps = buildSteps(ticket);
  const nowRef = useRef<HTMLLIElement>(null);

  // Long paths scroll horizontally; bring the current step into view.
  useEffect(() => {
    nowRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [ticket.id, ticket.status]);

  return (
    <Card title="Progress">
      <ol className="-mx-1 flex snap-x items-start gap-0 overflow-x-auto px-1 pb-2">
        {steps.map((s, i) => {
          const future = s.state === 'future';
          const prevFuture = steps[i - 1]?.state === 'future';
          return (
            <li
              key={s.key}
              ref={s.state === 'current' ? nowRef : undefined}
              className="relative flex w-[7.5rem] shrink-0 snap-center flex-col items-center px-1 text-center"
              aria-current={s.state === 'current' ? 'step' : undefined}
            >
              {/* connector to the previous node: solid once travelled, dashed ahead */}
              {i > 0 && (
                <span
                  aria-hidden
                  className={`absolute left-0 top-4 w-1/2 border-t-2 ${
                    future || prevFuture ? 'border-dashed border-slate-300 dark:border-slate-600' : 'border-solid border-emerald-500'
                  }`}
                />
              )}
              {i < steps.length - 1 && (
                <span
                  aria-hidden
                  className={`absolute right-0 top-4 w-1/2 border-t-2 ${
                    steps[i + 1].state === 'future' ? 'border-dashed border-slate-300 dark:border-slate-600' : 'border-solid border-emerald-500'
                  }`}
                />
              )}
              <span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 ${NODE[s.state]}`}>
                {s.state === 'done' ? <Check size={15} /> : s.state === 'returned' ? <CornerUpLeft size={15} />
                  : s.state === 'rejected' ? <X size={15} /> : s.state === 'current' ? <Circle size={9} fill="currentColor" /> : <span className="text-[10px] font-bold">{i + 1}</span>}
              </span>
              <span className={`mt-2 text-[11px] font-bold leading-tight ${future ? 'text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-100'}`}>
                {s.label}
              </span>
              {s.sub && <span className="mt-0.5 text-[10px] leading-tight text-slate-500 dark:text-slate-400">{s.sub}</span>}
              {s.date && <span className="mt-0.5 text-[10px] font-medium text-slate-400">{format(new Date(s.date), 'd MMM, HH:mm')}</span>}
              {s.spent && <span className="mt-0.5 text-[10px] text-slate-400">{s.spent} here</span>}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
