import { format } from 'date-fns';
import { ArrowLeft, FileSpreadsheet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { TicketDetail } from './types';
import {
  deskLabel, formatAge, hoursSince, isPostApproval, SLA_CLASS, slaOf, staffStatusLabel, STATUS_DESK, ticketNo,
} from '../../lib/ticketUi';

const PRIORITY: Record<string, string> = {
  URGENT: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
  NORMAL: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  LOW: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
};

export default function TicketHeader({ ticket, role }: { ticket: TicketDetail; role: string }) {
  const navigate = useNavigate();
  const closed = ticket.status === 'CLOSED' || ticket.status === 'DENIED';
  const held = hoursSince(ticket.status_changed_at ?? ticket.assigned_at ?? ticket.created_at);
  const sla = STATUS_DESK[ticket.status] && !closed ? slaOf(held) : null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 md:p-6">
      <div className="flex items-start gap-3">
        <button onClick={() => navigate(-1)} aria-label="Back" className="-ml-1 rounded-full p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700">
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">{ticketNo(ticket.id)}</span>
            {ticket.campus && <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300">{ticket.campus}</span>}
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-700 dark:bg-slate-700 dark:text-slate-200">{ticket.department}</span>
            {ticket.priority && ticket.priority !== 'NORMAL' && <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${PRIORITY[ticket.priority] ?? PRIORITY.NORMAL}`}>{ticket.priority}</span>}
          </div>
          <h1 className="mt-1 break-words text-lg font-bold text-slate-900 dark:text-white md:text-2xl">{ticket.title || 'Untitled ticket'}</h1>
          <p className={`mt-1 text-sm font-semibold ${ticket.status === 'DENIED' ? 'text-rose-600' : 'text-slate-700 dark:text-slate-200'}`}>
            {staffStatusLabel(ticket.status)}
          </p>
          {ticket.assignees?.current && (
            <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              With: {ticket.assignees.current.name ? `${ticket.assignees.current.name} (${deskLabel(ticket.assignees.current.desk)})` : deskLabel(ticket.assignees.current.desk)}
            </p>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span>Raised {format(new Date(ticket.created_at), 'd MMM yyyy, HH:mm')}</span>
            <span>Age {formatAge(hoursSince(ticket.created_at))}</span>
            {sla && (
              <span className={`rounded-full border px-2 py-0.5 font-bold ${SLA_CLASS[sla].chip}`}>
                At this desk {formatAge(held)}
              </span>
            )}
          </p>
        </div>
      </div>
      {role === 'JE' && isPostApproval(ticket.status) && (
        <button onClick={() => navigate(`/je/tender/${ticket.id}`)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 sm:w-auto sm:px-5">
          <FileSpreadsheet size={16} /> Tenders and resolution
        </button>
      )}
    </div>
  );
}
