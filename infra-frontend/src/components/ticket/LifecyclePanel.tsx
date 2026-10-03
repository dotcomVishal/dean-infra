import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { CheckCircle2, Circle, Flag, Gavel, Loader2, Paperclip, Send, X, XCircle } from 'lucide-react';
import { api } from '../../services/api';
import { toast } from '../../store/toastStore';
import { Card } from './Card';
import { errorMessage, inr, isPostApproval } from '../../lib/ticketUi';
import type { AvailableLifecycleAction, LifecycleAction, TicketDetail } from './types';

const fieldCls =
  'w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-900 dark:text-white';
const labelCls = 'mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500';

const STEP_BUTTON: Partial<Record<LifecycleAction, string>> = {
  PUBLISH_TENDER: 'Publish tender',
  START_TECHNICAL_EVAL: 'Start technical evaluation',
  START_FINANCIAL_EVAL: 'Start financial evaluation',
  AWARD: 'Award work',
};

const when = (iso?: string | null, fmt = 'd MMM yyyy, HH:mm') => (iso ? format(new Date(iso), fmt) : null);
const day = (iso?: string | null) => (iso ? format(new Date(iso), 'd MMM yyyy') : null);

/**
 * The JE's steps after approval. It renders only what `available_lifecycle_actions` allows (the server's own
 * rule table): the next tender step, "Cancel tender" during the tender stages, and "Resolve" on any open
 * ticket assigned to this JE. Nothing here decides what is allowed.
 */
export default function LifecyclePanel({ ticket, onDone }: { ticket: TicketDetail; onDone: () => void }) {
  const actions = ticket.available_lifecycle_actions ?? [];
  const tender = ticket.tenders?.[0] ?? null;
  const next = actions.find((a) => !['CANCEL_TENDER', 'RESOLVE'].includes(a.action)) ?? null;
  const cancel = actions.find((a) => a.action === 'CANCEL_TENDER') ?? null;
  const resolve = actions.find((a) => a.action === 'RESOLVE') ?? null;

  const [created, setCreated] = useState('');
  const [end, setEnd] = useState('');
  const [nit, setNit] = useState('');
  const [portal, setPortal] = useState('GeM');
  const [amount, setAmount] = useState('');
  const [agency, setAgency] = useState('');
  const [open, setOpen] = useState<'cancel' | 'resolve' | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [pickKey, setPickKey] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOpen(null); setReason(''); setNote(''); setFiles([]); setAmount(''); setAgency('');
  }, [ticket.id, ticket.status]);

  if (actions.length === 0 && ticket.status !== 'WORK_COMPLETED') return null;

  const send = async (action: LifecycleAction, payload: Record<string, string>, withFiles = false) => {
    setBusy(true);
    try {
      let body: Record<string, string> | FormData = { action, ...payload };
      if (withFiles && files.length > 0) {
        const fd = new FormData();
        fd.append('action', action);
        Object.entries(payload).forEach(([k, v]) => fd.append(k, v));
        files.forEach((f) => fd.append('files', f));
        body = fd;
      }
      const res = await api.post(`/tickets/${ticket.id}/lifecycle`, body);
      toast.success(res.data?.message || 'Updated.');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update the ticket.'));
    } finally {
      setBusy(false);
    }
  };

  const submitNext = (a: AvailableLifecycleAction) => {
    if (a.action === 'PUBLISH_TENDER') {
      if (!created || !end) return toast.error('Enter the tender created date and end date.');
      if (end < created) return toast.error('The end date must be on or after the created date.');
      return send(a.action, { tender_created_date: created, tender_end_date: end, portal_type: portal, ...(nit.trim() ? { nit_number: nit.trim() } : {}) });
    }
    if (a.action === 'AWARD') {
      if (!(Number(amount) > 0)) return toast.error('Enter the final award amount above 0.');
      if (!agency.trim()) return toast.error('Enter the agency name.');
      return send(a.action, { award_amount: amount, awarded_agency: agency.trim() });
    }
    return send(a.action, {});
  };

  const submitResolve = () => {
    if (resolve?.requires.includes('note') && !note.trim()) return toast.error('Enter the reason for resolving the ticket here.');
    return send('RESOLVE', note.trim() ? { note: note.trim() } : {}, true);
  };
  const submitCancel = () => {
    if (!reason.trim()) return toast.error('Enter the reason for cancelling the tender.');
    return send('CANCEL_TENDER', { reason: reason.trim() });
  };

  // ---- stepper ----------------------------------------------------------------------------
  const s = ticket.status;
  const order = ['APPROVED_FOR_TENDERING', 'TENDER_PUBLISHED', 'TECHNICAL_EVALUATION', 'FINANCIAL_EVALUATION', 'WORK_IN_PROGRESS', 'WORK_COMPLETED', 'CLOSED'];
  const at = order.indexOf(s);
  const resolvedFromTender = s === 'WORK_COMPLETED' || s === 'CLOSED';
  const steps: { key: string; label: string; done: boolean; detail: string | null }[] = [
    { key: 'pub', label: 'Published', done: at >= 1 || (resolvedFromTender && !!tender?.tender_created_date),
      detail: tender?.tender_created_date ? `${day(tender.tender_created_date)} to ${day(tender.tender_end_date)}${tender.nit_number ? ` · NIT ${tender.nit_number}` : ''}` : null },
    { key: 'tech', label: 'Technical', done: !!tender?.technical_eval_at, detail: when(tender?.technical_eval_at) },
    { key: 'fin', label: 'Financial', done: !!tender?.financial_eval_at, detail: when(tender?.financial_eval_at) },
    { key: 'award', label: 'Awarded', done: tender?.status === 'AWARDED',
      detail: tender?.status === 'AWARDED' ? `${tender.awarded_agency} · ${inr(tender.award_amount)}${tender.awarded_at ? ` · ${when(tender.awarded_at)}` : ''}` : null },
    { key: 'res', label: 'Resolved', done: s === 'WORK_COMPLETED' || s === 'CLOSED',
      detail: ticket.resolved_at ? `${when(ticket.resolved_at)}${ticket.resolution_kind === 'TENDER_CANCELLED' ? ' · tender cancelled' : ''}` : null },
    { key: 'closed', label: 'Closed', done: s === 'CLOSED', detail: null },
  ];

  return (
    <Card title="Tender and resolution" icon={<Gavel size={14} />}>
      {isPostApproval(s) && (
        <ol className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Progress">
          {steps.map((st) => (
            <li key={st.key} className="rounded-xl border border-slate-200 p-2.5 text-xs dark:border-slate-700">
              <span className={`flex items-center gap-1.5 font-bold ${st.done ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                {st.done ? <CheckCircle2 size={14} /> : <Circle size={14} />} {st.label}
              </span>
              {st.detail && <span className="mt-1 block break-words text-[11px] text-slate-500 dark:text-slate-400">{st.detail}</span>}
            </li>
          ))}
        </ol>
      )}
      {tender?.status === 'CANCELLED' && (
        <p className="mb-4 rounded-xl bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
          Tender cancelled{tender.cancel_reason ? `: ${tender.cancel_reason}` : ''}. A new ticket is needed for a new tender.
        </p>
      )}

      {s === 'WORK_COMPLETED' && (
        <p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          Resolved. The ticket closes after it is confirmed, or by itself seven days after it was resolved.
        </p>
      )}

      {next && (
        <form onSubmit={(e) => { e.preventDefault(); submitNext(next); }} className="space-y-3">
          {next.action === 'PUBLISH_TENDER' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label htmlFor="tcd" className={labelCls}>Tender created date <span className="text-rose-500">*</span></label>
                <input id="tcd" type="date" value={created} onChange={(e) => setCreated(e.target.value)} className={fieldCls} /></div>
              <div><label htmlFor="ted" className={labelCls}>Tender end date <span className="text-rose-500">*</span></label>
                <input id="ted" type="date" min={created || undefined} value={end} onChange={(e) => setEnd(e.target.value)} className={fieldCls} /></div>
              <div><label htmlFor="nit" className={labelCls}>NIT number (optional)</label>
                <input id="nit" value={nit} onChange={(e) => setNit(e.target.value)} className={fieldCls} /></div>
              <div><label htmlFor="portal" className={labelCls}>Portal</label>
                <select id="portal" value={portal} onChange={(e) => setPortal(e.target.value)} className={fieldCls}>
                  <option>GeM</option><option>CPP Portal</option><option>State Tender</option>
                </select></div>
            </div>
          )}
          {next.action === 'AWARD' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label htmlFor="amt" className={labelCls}>Final award amount (₹) <span className="text-rose-500">*</span></label>
                <input id="amt" type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={fieldCls} /></div>
              <div><label htmlFor="agency" className={labelCls}>Agency <span className="text-rose-500">*</span></label>
                <input id="agency" value={agency} onChange={(e) => setAgency(e.target.value)} className={fieldCls} /></div>
            </div>
          )}
          <button type="submit" disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60 sm:w-auto sm:px-6">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} {STEP_BUTTON[next.action] ?? next.action}
          </button>
        </form>
      )}

      {(cancel || resolve) && (
        <div className={`flex flex-wrap gap-2 ${next ? 'mt-4 border-t border-slate-100 pt-4 dark:border-slate-700' : ''}`}>
          {cancel && (
            <button type="button" onClick={() => setOpen(open === 'cancel' ? null : 'cancel')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950/30">
              <XCircle size={14} /> Cancel tender
            </button>
          )}
          {resolve && (
            <button type="button" onClick={() => setOpen(open === 'resolve' ? null : 'resolve')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700">
              <Flag size={14} /> Resolve
            </button>
          )}
        </div>
      )}

      {open === 'cancel' && cancel && (
        <div className="mt-3 space-y-3 rounded-xl border border-rose-200 p-3 dark:border-rose-900/60">
          <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">This resolves the ticket. A new ticket is needed for a new tender.</p>
          <label htmlFor="creason" className={labelCls}>Reason <span className="text-rose-500">*</span></label>
          <textarea id="creason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={`${fieldCls} resize-none`} />
          <button type="button" disabled={busy} onClick={submitCancel}
            className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-60">
            {busy && <Loader2 size={14} className="animate-spin" />} Cancel tender and resolve
          </button>
        </div>
      )}

      {open === 'resolve' && resolve && (
        <div className="mt-3 space-y-3 rounded-xl border border-emerald-200 p-3 dark:border-emerald-900/60">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">The ticket closes only after confirmation.</p>
          <label htmlFor="rnote" className={labelCls}>
            {resolve.requires.includes('note') ? <>Reason for resolving here <span className="text-rose-500">*</span></> : 'Note (optional)'}
          </label>
          <textarea id="rnote" rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={`${fieldCls} resize-none`} />
          <div>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200">
              <Paperclip size={12} /> Add completion photos or documents
              <input key={pickKey} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.heic,.pdf,.xlsx,.docx" className="hidden"
                onChange={(e) => { const picked = Array.from(e.target.files ?? []); setFiles((p) => [...p, ...picked].slice(0, 5)); setPickKey((k) => k + 1); }} />
            </label>
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="mt-1.5 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800">
                <span className="min-w-0 truncate text-slate-700 dark:text-slate-300">{f.name}</span>
                <button type="button" aria-label="Remove file" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} className="ml-2 text-slate-400 hover:text-rose-600"><X size={13} /></button>
              </div>
            ))}
          </div>
          <button type="button" disabled={busy} onClick={submitResolve}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
            {busy && <Loader2 size={14} className="animate-spin" />} Resolve ticket
          </button>
        </div>
      )}
    </Card>
  );
}
