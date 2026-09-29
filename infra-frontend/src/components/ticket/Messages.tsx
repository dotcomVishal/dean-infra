import { useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, ArrowRight, Eye, MessageSquare, Bell } from 'lucide-react';
import type { AuditEntry, TicketDetail, TicketMessage } from './types';
import { deskLabel } from '../../lib/ticketUi';
import { openThread, visibleToText } from '../../lib/threads';
import { Card } from './Card';

const KIND_LABEL: Record<TicketMessage['kind'], string> = {
  CHANGE_REQUEST: 'Change request',
  REPLY: 'Reply',
  INTERNAL_REMARK: 'Internal remark',
  REJECTION_REASON: 'Rejection reason',
  PUBLIC_NOTE: 'Note for applicant',
};
const KIND_STYLE: Record<TicketMessage['kind'], string> = {
  CHANGE_REQUEST: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  REPLY: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  INTERNAL_REMARK: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  REJECTION_REASON: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
  PUBLIC_NOTE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
};

const who = (desk: string | null, name: string | null) =>
  desk ? `${deskLabel(desk)}${name ? ` (${name})` : ''}` : '';

export function MessageItem({ m }: { m: TicketMessage }) {
  return (
    <li className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${KIND_STYLE[m.kind]}`}>{KIND_LABEL[m.kind]}</span>
        <span className="flex flex-wrap items-center gap-1 text-xs font-semibold text-slate-800 dark:text-slate-100">
          {who(m.author_desk, m.author_name)}
          {m.to_desk && (<><ArrowRight size={12} className="text-slate-400" />{who(m.to_desk, m.to_name)}</>)}
        </span>
        <span className="ml-auto text-[10px] font-medium text-slate-400">{format(new Date(m.created_at), 'd MMM, HH:mm')}</span>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 dark:text-slate-200">{m.body}</p>
      <p className="mt-2 flex items-start gap-1 text-[10px] text-slate-400">
        <Eye size={11} className="mt-px shrink-0" /> Visible to: {visibleToText(m)}
      </p>
    </li>
  );
}

/** Sits above the action panel: highlights the active return thread. */
export function ChangeRequestBanner({ ticket, myDesk }: { ticket: TicketDetail; myDesk: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const { head, thread } = openThread(ticket.messages ?? [], ticket.open_change_request_id);
  if (!head) return null;
  const forMe = myDesk != null && head.to_desk === myDesk;
  const older = thread.filter((m) => m.id !== head.id);

  return (
    <div
      role="region"
      aria-label="Open change request"
      className={`rounded-2xl border-2 p-4 shadow-sm md:p-5 ${
        forMe
          ? 'border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/30'
          : 'border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20'
      }`}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            {forMe ? 'Open change request — needs your reply' : 'Open change request'}
          </p>
          <p className="mt-0.5 text-sm font-bold text-slate-900 dark:text-white">
            {who(head.author_desk, head.author_name)} → {who(head.to_desk, head.to_name)}
            <span className="ml-2 text-xs font-medium text-slate-500">{format(new Date(head.created_at), 'd MMM, HH:mm')}</span>
          </p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800 dark:text-slate-100">{head.body}</p>
          <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-500"><Eye size={11} /> Visible to: {visibleToText(head)}</p>
          {(older.length > 0) && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-3 text-xs font-semibold text-amber-800 underline-offset-2 hover:underline dark:text-amber-300"
            >
              {expanded ? 'Hide thread' : `Show thread (${older.length} more)`}
            </button>
          )}
          {expanded && (
            <ul className="mt-3 space-y-2">{older.map((m) => <MessageItem key={m.id} m={m} />)}</ul>
          )}
        </div>
      </div>
    </div>
  );
}

const MOVEMENT_LABEL: Record<string, string> = {
  CREATED: 'Ticket raised', ASSIGNED: 'Assigned to JE', REASSIGNED: 'Reassigned',
  SUBMITTED: 'JE report submitted', FORWARDED: 'Forwarded', APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested', REJECTED: 'Rejected',
  TENDER_PUBLISHED: 'Tender published', WORK_AWARDED: 'Work awarded', WORK_COMPLETED: 'Work completed',
  BILL_RECORDED: 'Bill recorded', BILL_UPDATED: 'Bill updated', CLOSED: 'Closed', OVERRIDE: 'Administrative update',
  PASSED: 'Forwarded', RETURNED: 'Returned to JE', DENIED: 'Rejected',
};

/** Messages (with sender → recipient and "Visible to") followed by the audit trail, reminders collapsed. */
export function MessagesTimeline({ ticket }: { ticket: TicketDetail }) {
  const messages = ticket.messages ?? [];
  const audit: AuditEntry[] = ticket.audit_logs ?? [];
  const reminders = audit.filter((a) => a.action === 'REMINDER_SENT');
  const trail = audit.filter((a) => a.action !== 'REMINDER_SENT');
  if (messages.length === 0 && trail.length === 0 && reminders.length === 0) return null;

  return (
    <Card title="Messages & timeline" icon={<MessageSquare size={14} />}>
      {messages.length > 0 && <ul className="mb-5 space-y-2.5">{messages.map((m) => <MessageItem key={m.id} m={m} />)}</ul>}

      {trail.length > 0 && (
        <ol className="space-y-3">
          {trail.map((a, i) => (
            <li key={i} className="relative border-l-2 border-slate-200 pb-1 pl-4 dark:border-slate-700">
              <span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-blue-500" />
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  {MOVEMENT_LABEL[a.action] ?? a.action}
                  {a.from_desk && a.to_desk ? ` · ${deskLabel(a.from_desk)} → ${deskLabel(a.to_desk)}` : ''}
                </span>
                <span className="text-[10px] font-medium text-slate-400">{format(new Date(a.created_at), 'd MMM yyyy, HH:mm')}</span>
              </div>
              {(a.actor_name || a.actor_role) && (
                <p className="text-[11px] text-slate-500">{a.actor_name ? `${a.actor_name} · ` : ''}{deskLabel(a.actor_role)}</p>
              )}
              {a.remarks && <p className="mt-1 break-words text-xs text-slate-600 dark:text-slate-300">{a.remarks}</p>}
            </li>
          ))}
        </ol>
      )}

      {reminders.length > 0 && (
        <p className="mt-4 flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
          <Bell size={13} /> {reminders.length} reminder{reminders.length > 1 ? 's' : ''} sent
          {' '}(last {format(new Date(reminders[reminders.length - 1].created_at), 'd MMM, HH:mm')})
        </p>
      )}
    </Card>
  );
}
