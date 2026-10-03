import { useState } from 'react';
import { format } from 'date-fns';
import { ClipboardList, ExternalLink, IndianRupee, MapPin } from 'lucide-react';
import type { TicketDetail, TicketMessage } from './types';
import { AttachmentList } from './Attachments';
import { Card, Label } from './Card';
import { DESK_RANK, deskLabel, mapsHref } from '../../lib/ticketUi';

function ReportBody({ ticket }: { ticket: TicketDetail }) {
  const [more, setMore] = useState(false);
  const r = ticket.report;
  if (!r) return <p className="text-sm text-slate-400">No report filed yet.</p>;
  // Only the files of THIS report version; earlier versions' files are listed apart below.
  const mine = (a: { report_id?: number }) => a.report_id === r.id;
  const photos = ticket.attachments.filter((a) => a.document_category === 'JE_SITE_PHOTO' && mine(a));
  const docs = ticket.attachments.filter((a) => a.document_category === 'JE_ESTIMATE_DOC' && mine(a));
  const earlier = ticket.attachments.filter(
    (a) => (a.document_category === 'JE_SITE_PHOTO' || a.document_category === 'JE_ESTIMATE_DOC') && !mine(a));
  const long = r.nature_of_work.length > 240;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Label>Estimate{r.version ? ` · report v${r.version}` : ''}</Label>
          <p className="flex items-center gap-1 font-mono text-2xl font-black text-slate-900 dark:text-white">
            <IndianRupee size={20} className="text-emerald-600" />
            {Number(r.estimated_amount).toLocaleString('en-IN')}
          </p>
        </div>
        <p className="text-[11px] text-slate-400">Filed {format(new Date(r.created_at), 'd MMM yyyy, HH:mm')}</p>
      </div>
      <div>
        <Label>Findings</Label>
        <p className={`whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 dark:text-slate-200 ${long && !more ? 'line-clamp-4' : ''}`}>
          {r.nature_of_work}
        </p>
        {long && (
          <button type="button" onClick={() => setMore((v) => !v)} className="mt-1 text-xs font-semibold text-blue-600 dark:text-blue-400">
            {more ? 'Show less' : 'Read more'}
          </button>
        )}
      </div>
      {photos.length > 0 && (
        <div><Label>Site photos ({photos.length})</Label><AttachmentList files={photos} cols="grid-cols-4 sm:grid-cols-6" /></div>
      )}
      {docs.length > 0 && (
        <div><Label>Documents ({docs.length})</Label><AttachmentList files={docs} /></div>
      )}
      {earlier.length > 0 && (
        <details className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
          <summary className="cursor-pointer text-xs font-semibold text-slate-500">Files from earlier report versions ({earlier.length})</summary>
          <div className="mt-2"><AttachmentList files={earlier} /></div>
        </details>
      )}
    </div>
  );
}

/** Last message written by each desk, so a reader sees where the ticket has been. */
function lastWordPerDesk(messages: TicketMessage[]) {
  const latest = new Map<string, TicketMessage>();
  messages.filter((m) => m.kind !== 'PUBLIC_NOTE').forEach((m) => latest.set(m.author_desk, m));
  return [...latest.values()].sort((a, b) => (DESK_RANK[a.author_desk] ?? 0) - (DESK_RANK[b.author_desk] ?? 0));
}

/** Top of the page for AE and above: everything needed to decide, without scrolling. */
export function DecisionBrief({ ticket }: { ticket: TicketDetail }) {
  const words = lastWordPerDesk(ticket.messages ?? []);
  return (
    <Card title="Summary" icon={<ClipboardList size={14} />} className="border-blue-200 dark:border-blue-900/60">
      <div className="space-y-4">
        <div>
          <Label>The issue</Label>
          <p className="text-sm font-bold text-slate-900 dark:text-white">{ticket.title || 'Untitled ticket'}</p>
          <p className="mt-0.5 line-clamp-2 break-words text-sm text-slate-600 dark:text-slate-300">{ticket.description}</p>
        </div>
        <div>
          <Label>Where</Label>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-800 dark:text-slate-200">
            <span className="flex items-start gap-1.5"><MapPin size={15} className="mt-0.5 shrink-0 text-rose-500" />{[ticket.campus && `${ticket.campus} campus`, ticket.landmark].filter(Boolean).join(' · ')}</span>
            <a href={mapsHref(ticket)} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400">
              <ExternalLink size={12} /> Map
            </a>
          </div>
        </div>
        <div className="border-t border-slate-100 pt-4 dark:border-slate-700"><ReportBody ticket={ticket} /></div>
        {words.length > 0 && (
          <div className="border-t border-slate-100 pt-4 dark:border-slate-700">
            <Label>Latest from each desk</Label>
            <ul className="space-y-1.5">
              {words.map((m) => (
                <li key={m.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900/50">
                  <span className="font-bold text-slate-800 dark:text-slate-100">
                    {deskLabel(m.author_desk)}{m.to_desk ? ` → ${deskLabel(m.to_desk)}` : ''}
                  </span>
                  <span className="ml-2 text-slate-400">{format(new Date(m.created_at), 'd MMM')}</span>
                  <p className="mt-0.5 line-clamp-2 break-words text-slate-600 dark:text-slate-300">{m.body}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

/** For desks without the brief (JE): just the filed report. */
export function ReportCard({ ticket }: { ticket: TicketDetail }) {
  if (!ticket.report) return null;
  return <Card title="Inspection Report" icon={<ClipboardList size={14} />}><ReportBody ticket={ticket} /></Card>;
}
