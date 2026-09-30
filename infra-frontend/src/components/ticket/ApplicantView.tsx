import { useState } from 'react';
import { format } from 'date-fns';
import { ArrowLeft, Building2, CheckCircle2, FileText, MapPin, XCircle, ExternalLink, Image as ImageIcon, Loader2, Wrench } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { TicketDetail } from './types';
import { AttachmentList, UploadFiles } from './Attachments';
import { api } from '../../services/api';
import { toast } from '../../store/toastStore';
import { Card, Label } from './Card';
import { applicantStage, errorMessage, mapsHref, ticketNo } from '../../lib/ticketUi';

// The applicant sees the stage in plain words and their own photos. Nothing else.
// This view reads an explicit allow-list of fields off the payload: even if the
// API ever over-shared (staff names, phones, site photos, estimates), none of it
// has a place to render here.
const STEPS = ['Received', 'Under JE inspection', 'Under review', 'Approved — tendering', 'Work in progress', 'Work done — please verify', 'Completed'];

const stepIndex = (stage: string) => {
  const i = STEPS.indexOf(stage);
  return i === -1 ? 0 : i;
};

/** Shown only while the JE has marked the work complete: the applicant closes or sends it back. */
function VerifyWork({ ticketId, onDone }: { ticketId: number; onDone: () => void }) {
  const [disputing, setDisputing] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  const answer = async (accepted: boolean) => {
    setBusy(true);
    try {
      const res = await api.post(`/tickets/${ticketId}/confirm-completion`, { accepted, remarks: remarks.trim() || undefined });
      toast.success(res.data.message);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not send your answer.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Is the work done?" icon={<Wrench size={14} />}>
      <p className="text-sm text-slate-700 dark:text-slate-200">
        The engineer has marked this work complete. Please check the site. The ticket closes only after you confirm.
      </p>
      {disputing && (
        <textarea
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={3}
          placeholder="What is still not done?"
          className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        />
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {!disputing ? (
          <>
            <button type="button" disabled={busy} onClick={() => answer(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Yes, work is done
            </button>
            <button type="button" disabled={busy} onClick={() => setDisputing(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 px-4 py-2 text-sm font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:hover:bg-rose-950/30">
              <XCircle size={14} /> Not done
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={busy || remarks.trim() === ''} onClick={() => answer(false)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50">
              {busy && <Loader2 size={14} className="animate-spin" />} Send back to engineer
            </button>
            <button type="button" disabled={busy} onClick={() => setDisputing(false)}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">
              Cancel
            </button>
          </>
        )}
      </div>
    </Card>
  );
}

export default function ApplicantView({ ticket, onChanged }: { ticket: TicketDetail; onChanged: () => void }) {
  const navigate = useNavigate();
  const stage = applicantStage(ticket.status, ticket.stage_label);
  const rejected = ticket.status === 'DENIED' || stage === 'Rejected';
  const at = stepIndex(stage);

  // Their own evidence only: never JE site photos or estimate documents.
  const ownPhotos = ticket.attachments.filter(
    (a) => !a.document_category || a.document_category === 'APPLICANT_EVIDENCE');
  // The JE's execution / completion photos: what the applicant verifies against.
  const workFiles = ticket.attachments.filter((a) => a.document_category === 'WORK_DOC');
  const open = ticket.status !== 'CLOSED' && !rejected;
  // Notes the desk explicitly chose to share.
  const notes = (ticket.messages ?? []).filter((m) => m.kind === 'PUBLIC_NOTE');

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 pb-16 animate-in fade-in duration-300">
      <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 md:p-6">
        <button onClick={() => navigate(-1)} aria-label="Back" className="-ml-1 rounded-full p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700">
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0">
          <p className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">{ticketNo(ticket.id)}</p>
          <h1 className="break-words text-xl font-bold text-slate-900 dark:text-white">{ticket.title || 'Your request'}</h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Reported {format(new Date(ticket.created_at), 'PPP')}</p>
        </div>
      </div>

      <Card>
        <Label>Status</Label>
        <p className={`flex items-center gap-2 text-2xl font-black ${rejected ? 'text-rose-600' : 'text-slate-900 dark:text-white'}`}>
          {rejected ? <XCircle size={26} /> : <CheckCircle2 size={26} className="text-emerald-500" />} {stage}
        </p>
        {!rejected && (
          <ol className="mt-5 grid grid-cols-7 gap-1" aria-label="Progress">
            {STEPS.map((s, i) => (
              <li key={s} className="flex flex-col items-center gap-1.5 text-center">
                <span className={`h-2 w-full rounded-full ${i < at ? 'bg-emerald-500' : i === at ? 'bg-blue-600' : 'border border-dashed border-slate-300 dark:border-slate-600'}`} />
                <span className={`text-[10px] leading-tight ${i === at ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-400'}`}>{s}</span>
              </li>
            ))}
          </ol>
        )}
        {notes.map((n) => (
          <p key={n.id} className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-900/50 dark:text-slate-200">{n.body}</p>
        ))}
      </Card>

      {ticket.status === 'WORK_COMPLETED' && <VerifyWork ticketId={ticket.id} onDone={onChanged} />}

      {workFiles.length > 0 && (
        <Card title="Work photos from the engineer" icon={<Wrench size={14} />}>
          <AttachmentList files={workFiles} cols="grid-cols-3 sm:grid-cols-4" />
        </Card>
      )}

      <Card title="Your request" icon={<FileText size={14} />}>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800 dark:text-slate-100">{ticket.description}</p>
        <div className="mt-5 grid gap-4 border-t border-slate-100 pt-4 dark:border-slate-700 sm:grid-cols-2">
          <div>
            <Label>Department</Label>
            <p className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200"><Building2 size={15} className="text-blue-500" />{ticket.department}</p>
          </div>
          <div>
            <Label>Location</Label>
            <p className="flex items-start gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
              <MapPin size={15} className="mt-0.5 shrink-0 text-rose-500" />
              <span>{ticket.campus ? `${ticket.campus} campus · ` : ''}{ticket.location}</span>
            </p>
            <a href={mapsHref(ticket)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400">
              <ExternalLink size={12} /> Open in Maps
            </a>
          </div>
        </div>
      </Card>

      <Card title="Your photos" icon={<ImageIcon size={14} />}>
        <AttachmentList files={ownPhotos} empty="You did not attach any photos." cols="grid-cols-3 sm:grid-cols-4" />
        {open && <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-700"><UploadFiles ticketId={ticket.id} onDone={onChanged} label="Add photos" /></div>}
      </Card>
    </div>
  );
}
