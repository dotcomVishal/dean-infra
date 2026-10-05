import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, CornerUpLeft, Eye, Loader2, Paperclip, Send, UserCheck, X, XCircle, ClipboardCheck, Gavel } from 'lucide-react';
import { api } from '../../services/api';
import { toast } from '../../store/toastStore';
import { DESK_RANK, deskLabel, errorMessage, inr, visibleDesks } from '../../lib/ticketUi';
import type { AvailableAction, TicketDetail } from './types';
import ReportForm from './ReportForm';
import { checkFiles, loadUploadLimits, type UploadLimits } from '../../lib/uploadLimits';

// Must match the API allow-list (middleware/upload.js).
const FILE_ACCEPT = '.jpg,.jpeg,.png,.webp,.heic,.pdf,.xlsx,.docx';

interface JeChoice { id: number; name: string; open_tickets: number; on_leave: boolean; same_campus: boolean }

const fieldCls =
  'w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-900 dark:text-white';

const TONE = {
  blue: { on: 'border-blue-500 bg-blue-50 dark:bg-blue-950/40', btn: 'bg-blue-600 hover:bg-blue-700', ic: 'text-blue-600' },
  emerald: { on: 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40', btn: 'bg-emerald-600 hover:bg-emerald-700', ic: 'text-emerald-600' },
  amber: { on: 'border-amber-500 bg-amber-50 dark:bg-amber-950/40', btn: 'bg-amber-600 hover:bg-amber-700', ic: 'text-amber-600' },
  rose: { on: 'border-rose-500 bg-rose-50 dark:bg-rose-950/40', btn: 'bg-rose-600 hover:bg-rose-700', ic: 'text-rose-600' },
} as const;

function meta(a: AvailableAction) {
  switch (a.action) {
    case 'FORWARD': {
      const to = deskLabel(a.targets?.[0]);
      return { label: `Forward to ${to}`, hint: `Goes to the ${to} desk`, tone: 'blue' as const, Icon: ArrowRight };
    }
    case 'APPROVE':
      if (a.escalates_to) {
        const to = deskLabel(a.escalates_to);
        return { label: `Approve (escalates to ${to})`, hint: `Above your limit — ${to} desk decides next`, tone: 'emerald' as const, Icon: CheckCircle2 };
      }
      return { label: 'Approve', hint: 'Approve the work for tendering', tone: 'emerald' as const, Icon: CheckCircle2 };
    case 'REQUEST_CHANGES':
      return { label: 'Request changes', hint: 'Send it back with a message', tone: 'amber' as const, Icon: CornerUpLeft };
    case 'REJECT':
      return { label: 'Reject', hint: 'Close the ticket as rejected', tone: 'rose' as const, Icon: XCircle };
    case 'RESOLVE':
      return { label: 'Mark resolved', hint: 'The work is finished, or no longer needed. The applicant verifies.', tone: 'amber' as const, Icon: CheckCircle2 };
    case 'ASSIGN_JE':
      return { label: 'Assign JE', hint: 'No JE was free. Choose one.', tone: 'blue' as const, Icon: UserCheck };
    default:
      return { label: 'Inspection Report', hint: 'Enter findings and an estimate for the AE', tone: 'blue' as const, Icon: ClipboardCheck };
  }
}

function VisibleTo({ desks, extra }: { desks: string[]; extra?: string }) {
  return (
    <p className="mt-1 flex items-start gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
      <Eye size={12} className="mt-px shrink-0" />
      <span>Visible to: {[...(extra ? [extra] : []), ...desks].join(', ')}</span>
    </p>
  );
}

/** Renders ONLY what the API says this person may do (available_actions). No client-side permission logic. */
export default function ActionPanel({ ticket, onDone }: { ticket: TicketDetail; onDone: () => void }) {
  const aa = ticket.available_actions;
  // The tender steps have their own forms on the tender page; this panel offers the rest.
  const hasTenderSteps = (aa?.actions ?? []).some((a) => a.action.startsWith('TENDER_'));
  const actions = (aa?.actions ?? []).filter((a) => !a.action.startsWith('TENDER_'));
  const desk = aa?.desk ?? null;

  const [selected, setSelected] = useState<string | null>(null);
  const [toDesk, setToDesk] = useState('');
  const [message, setMessage] = useState('');
  const [internal, setInternal] = useState('');
  const [publicNote, setPublicNote] = useState('');
  const [assignee, setAssignee] = useState('');
  const [jes, setJes] = useState<JeChoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [restricted, setRestricted] = useState(false);
  const [limits, setLimits] = useState<UploadLimits | null>(null);

  useEffect(() => { loadUploadLimits().then(setLimits); }, []);

  // One choice = no extra tap. Reset the form whenever the ticket moves.
  const enabledCount = actions.filter((a) => a.enabled).length;
  useEffect(() => {
    setSelected(enabledCount === 1 ? actions.find((a) => a.enabled)!.action : null);
    setToDesk(''); setMessage(''); setInternal(''); setPublicNote(''); setAssignee(''); setFiles([]); setRestricted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id, ticket.status, enabledCount]);

  useEffect(() => {
    if (selected !== 'ASSIGN_JE') return;
    api.get(`/tickets/${ticket.id}/assignable-jes`)
      .then((r) => setJes(r.data.jes ?? []))
      .catch((e) => toast.error(errorMessage(e, 'Could not load the JE list.')));
  }, [selected, ticket.id]);

  if ((actions.length === 0 && !hasTenderSteps) || !desk) return null;

  const current = actions.find((a) => a.action === selected) ?? null;
  const rc = actions.find((a) => a.action === 'REQUEST_CHANGES');
  const limit = ticket.approval_limit;
  const estimate = ticket.report?.estimated_amount;
  const sendTo = toDesk || (rc?.targets?.length === 1 ? rc.targets[0] : '');
  const myRank = DESK_RANK[desk] ?? 1;

  const submit = async () => {
    if (!current) return;
    if (current.action === 'RESOLVE') {
      if (!message.trim()) return toast.error('Enter a note.');
      const early = ticket.status !== 'WORK_IN_PROGRESS';
      const ok = window.confirm(early
        ? 'This marks the ticket resolved and skips the remaining steps. The applicant will be asked to verify it. Continue?'
        : 'Mark this ticket resolved? The applicant will be asked to verify it.');
      if (!ok) return;
      setBusy(true);
      try {
        const res = await api.post(`/tickets/${ticket.id}/resolve`, { note: message.trim() });
        toast.success(res.data?.message || 'Marked resolved.');
        onDone();
      } catch (err) {
        toast.error(errorMessage(err, 'Could not mark the ticket resolved.'));
      } finally {
        setBusy(false);
      }
      return;
    }
    const payload: Record<string, unknown> = { action: current.action };
    if (current.action === 'REQUEST_CHANGES') {
      if (!sendTo) return toast.error('Choose a desk.');
      if (!message.trim()) return toast.error('Enter what needs to change.');
      payload.to_desk = sendTo; payload.message = message.trim();
    }
    if (current.action === 'REJECT') {
      if (!message.trim()) return toast.error('Enter a reason.');
      payload.message = message.trim();
      if (publicNote.trim()) payload.public_note = publicNote.trim();
    }
    if (current.reply_required) {
      if (!message.trim()) return toast.error('Reply to the request first.');
      payload.message = message.trim();
    }
    if (current.action === 'ASSIGN_JE') {
      if (!assignee) return toast.error('Choose a JE.');
      payload.assignee_id = Number(assignee);
    }
    if (internal.trim() && current.action !== 'ASSIGN_JE') payload.internal_remark = internal.trim();

    // Files travel with the move: multipart when there are any, JSON otherwise.
    let body: Record<string, unknown> | FormData = payload;
    if (files.length > 0 && current.action !== 'ASSIGN_JE') {
      if (limits) {
        if (files.length > limits.attachment_files) return toast.error(`At most ${limits.attachment_files} files.`);
        const tooBig = checkFiles(files, limits);
        if (tooBig) return toast.error(tooBig);
      }
      const fd = new FormData();
      Object.entries(payload).forEach(([k, v]) => fd.append(k, String(v)));
      if (restricted) fd.append('restricted_files', 'true');
      files.forEach((f) => fd.append('files', f));
      body = fd;
    }

    setBusy(true);
    try {
      const res = await api.post(`/tickets/${ticket.id}/actions`, body);
      toast.success(res.data?.message || 'Ticket updated.');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not complete this action.'));
    } finally {
      setBusy(false);
    }
  };

  const tone = current ? TONE[meta(current).tone] : TONE.blue;

  return (
    <section
      aria-label="Action"
      className="rounded-2xl border-2 border-blue-500/30 bg-white p-4 shadow-sm dark:bg-slate-800 md:p-6"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">{deskLabel(desk)} desk</p>
          <h2 className="mt-0.5 flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
            <Gavel size={16} /> Action
          </h2>
        </div>
        {limit?.can_approve && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-right text-[11px] dark:border-slate-700 dark:bg-slate-900/50">
            <span className="block font-bold uppercase text-slate-400">Approval limit</span>
            <span className="font-mono font-bold text-slate-900 dark:text-white">
              {limit.unlimited ? 'Unlimited' : limit.amount == null ? 'Not configured' : inr(limit.amount)}
            </span>
            {estimate != null && <span className="block text-slate-500">Estimate {inr(estimate)}</span>}
          </div>
        )}
      </div>

      {/* Buttons come straight from available_actions. */}
      <div className={`grid gap-2 ${actions.length > 1 ? 'sm:grid-cols-2' : ''}`}>
        {actions.map((a) => {
          const m = meta(a);
          const active = selected === a.action;
          return (
            <button
              key={a.action}
              type="button"
              disabled={!a.enabled}
              onClick={() => setSelected(a.action)}
              aria-pressed={active}
              className={`flex min-h-[3.5rem] items-start gap-3 rounded-xl border-2 p-3 text-left transition ${
                active ? TONE[m.tone].on : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <m.Icon size={18} className={`mt-0.5 shrink-0 ${TONE[m.tone].ic}`} />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-slate-900 dark:text-white">{m.label}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{a.enabled ? m.hint : a.reason ?? 'Not available right now.'}</span>
              </span>
            </button>
          );
        })}
      </div>

      {hasTenderSteps && (
        <Link to={`/je/tender/${ticket.id}`} className="mt-3 flex items-center justify-between rounded-xl border-2 border-emerald-500/40 bg-emerald-50 p-3 text-sm font-bold text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300">
          Open tender control <ArrowRight size={16} />
        </Link>
      )}

      {current?.action === 'RESOLVE' && (
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-700">
          {ticket.status !== 'WORK_IN_PROGRESS' && (
            <p className="rounded-lg bg-amber-50 p-3 text-xs font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              The ticket is not at the awarded stage. Marking it resolved skips the remaining steps.
            </p>
          )}
          <div>
            <label htmlFor="resolve-note" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Note <span className="text-rose-500">*</span>
            </label>
            <textarea id="resolve-note" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} className={`${fieldCls} resize-none`}
              placeholder="What was done, or why no work is needed" />
          </div>
          <button type="button" onClick={submit} disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-600 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-amber-700 disabled:opacity-60">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Mark resolved
          </button>
        </div>
      )}

      {current?.action === 'SUBMIT_REPORT' && (
        <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-700">
          <ReportForm
            ticketId={ticket.id}
            previous={ticket.report}
            replyTo={current.reply_required ? current.reply_to_desk ?? 'the desk' : null}
            onDone={onDone}
          />
        </div>
      )}

      {current && current.action !== 'SUBMIT_REPORT' && current.action !== 'RESOLVE' && (
        <div className="mt-4 space-y-4 border-t border-slate-100 pt-4 dark:border-slate-700">
          {current.action === 'ASSIGN_JE' && (
            <div>
              <label htmlFor="assignee" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Choose JE</label>
              <select id="assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} className={fieldCls}>
                <option value="">Select a JE…</option>
                {jes.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name} · {j.open_tickets} open{j.on_leave ? ' · on leave' : ''}{j.same_campus ? '' : ' · other campus'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {current.action === 'REQUEST_CHANGES' && (
            <>
              <div>
                <label htmlFor="sendto" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Send to <span className="text-rose-500">*</span>
                </label>
                <select id="sendto" value={sendTo} onChange={(e) => setToDesk(e.target.value)} className={fieldCls}>
                  <option value="">Select a desk…</option>
                  {(rc?.targets ?? []).map((d) => (
                    <option key={d} value={d}>{deskLabel(d)}{ticket.desk_people?.[d] ? ` — ${ticket.desk_people[d]}` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="msg" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  What needs to change <span className="text-rose-500">*</span>
                </label>
                <textarea id="msg" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} className={`${fieldCls} resize-none`} />
                {sendTo ? <VisibleTo desks={visibleDesks(DESK_RANK[sendTo])} /> : (
                  <p className="mt-1 text-[11px] text-slate-400">Pick a desk to see who can read this message.</p>
                )}
              </div>
            </>
          )}

          {current.reply_required && current.action !== 'SUBMIT_REPORT' && (
            <div>
              <label htmlFor="reply" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Reply to {deskLabel(current.reply_to_desk)} <span className="text-rose-500">*</span>
              </label>
              <textarea id="reply" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} className={`${fieldCls} resize-none`} />
              <VisibleTo desks={visibleDesks(myRank)} />
            </div>
          )}

          {current.action === 'REJECT' && (
            <>
              <div>
                <label htmlFor="why" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Reason for rejecting <span className="text-rose-500">*</span>
                </label>
                <textarea id="why" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} className={`${fieldCls} resize-none`} />
                <VisibleTo desks={visibleDesks(1)} />
              </div>
              <div>
                <label htmlFor="pub" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Note for the applicant (optional)</label>
                <textarea id="pub" rows={2} value={publicNote} onChange={(e) => setPublicNote(e.target.value)} className={`${fieldCls} resize-none`} />
                <VisibleTo desks={visibleDesks(1)} extra="Applicant" />
              </div>
            </>
          )}

          {current.action !== 'ASSIGN_JE' && (
            <div>
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Attach documents (optional)</span>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-white hover:bg-slate-900 dark:bg-slate-600">
                <Paperclip size={13} /> Add files
                <input type="file" multiple accept={FILE_ACCEPT} className="hidden"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []);
                    e.target.value = ''; // the same file can be chosen again
                    setFiles((p) => [...p, ...picked].slice(0, limits?.attachment_files ?? 10));
                  }} />
              </label>
              {files.map((f, i) => (
                <div key={`${f.name}-${i}`} className="mt-1.5 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800">
                  <span className="min-w-0 truncate text-slate-700 dark:text-slate-300">{f.name}</span>
                  <button type="button" aria-label="Remove file" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} className="ml-2 text-slate-400 hover:text-rose-600"><X size={13} /></button>
                </div>
              ))}
              {files.length > 0 && (
                <label className="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} />
                  Only my desk and above can open these files
                </label>
              )}
            </div>
          )}

          {current.action !== 'ASSIGN_JE' && (
            <div>
              <label htmlFor="internal" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Internal remark (optional)</label>
              <textarea id="internal" rows={2} value={internal} onChange={(e) => setInternal(e.target.value)} className={`${fieldCls} resize-none`}
                placeholder="Read by your desk and above." />
              <VisibleTo desks={visibleDesks(myRank)} />
            </div>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white shadow-sm transition disabled:opacity-60 ${tone.btn}`}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {meta(current).label}
          </button>
        </div>
      )}
    </section>
  );
}
