import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, CheckCircle2, Circle, Clock, Loader2, RefreshCw } from 'lucide-react';
import { api } from '../../services/api';
import { toast } from '../../store/toastStore';
import { GroupedAttachments, UploadFiles } from '../../components/ticket/Attachments';
import type { TicketDetail } from '../../components/ticket/types';
import { errorMessage, staffStatusLabel, ticketNo, inr } from '../../lib/ticketUi';
import { inGroup, POST_APPROVAL } from '../../lib/statuses';

interface TicketSummary {
  id: number;
  title?: string;
  description: string;
  department: string;
  status: string;
  created_at: string;
  estimated_amount?: number | string | null;
  awarded_amount?: number | string | null;
}

const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d?: string | null) => (d ? format(new Date(d), 'd MMM yyyy') : '');

const fieldCls =
  'w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs md:text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500';
const labelCls = 'block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wider';

// The stages, in order. `next` is the action that moves the ticket onto that stage.
// A cancelled tender is shown beside the list, not in it.
const STEPS = [
  { key: 'APPROVED_FOR_TENDERING', title: 'Approved', next: null, button: '' },
  { key: 'TENDER_PUBLISHED', title: 'Tender published', next: 'TENDER_PUBLISH', button: 'Mark as published' },
  { key: 'TECHNICAL_EVALUATION', title: 'Technical evaluation', next: 'TENDER_TECHNICAL', button: 'Mark technical evaluation' },
  { key: 'FINANCIAL_EVALUATION', title: 'Financial evaluation', next: 'TENDER_FINANCIAL', button: 'Mark financial evaluation' },
  { key: 'WORK_IN_PROGRESS', title: 'Awarded', next: 'TENDER_AWARD', button: 'Mark as awarded' },
  { key: 'WORK_COMPLETED', title: 'Resolved', next: 'RESOLVE', button: 'Mark resolved' },
  { key: 'CLOSED', title: 'Closed', next: null, button: '' },
] as const;

/** Records one stage. Posts to the same endpoints as before; the server decides what is allowed. */
function NextStep({ ticketId, action, estimate, onDone, onCancel }: {
  ticketId: number; action: string; estimate?: number | string | null; onDone: () => void; onCancel: () => void;
}) {
  const stage = action.replace('TENDER_', '');
  const [created, setCreated] = useState(today());
  const [end, setEnd] = useState('');
  const [amount, setAmount] = useState(estimate != null ? String(estimate) : '');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const isResolve = action === 'RESOLVE';
  const isCancel = stage === 'CANCEL';
  const missing =
    stage === 'PUBLISH' ? !created || !end || end < created
      : stage === 'AWARD' ? !(Number(amount) > 0)
        : isCancel ? !reason.trim()
          : isResolve ? !note.trim() : false;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (missing || busy) return;
    setBusy(true);
    try {
      if (isResolve) {
        const res = await api.post(`/tickets/${ticketId}/resolve`, { note: note.trim() });
        toast.success(res.data?.message || 'Marked resolved.');
      } else {
        const fd = new FormData();
        fd.append('stage', stage);
        if (stage === 'PUBLISH') { fd.append('published_date', created); fd.append('bid_end_date', end); }
        if (stage === 'AWARD') fd.append('award_amount', amount.trim());
        if (isCancel) fd.append('reason', reason.trim());
        if (note.trim()) fd.append('remarks', note.trim());
        const res = await api.post(`/tickets/${ticketId}/tender-stage`, fd);
        toast.success(res.data?.message || 'Stage updated.');
      }
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update the stage.'));
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (code === 'STAGE_NOT_ALLOWED' || code === 'CONFLICT') onDone(); // the ticket moved on: show it as it is
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 border-t border-slate-200/70 pt-3 dark:border-slate-700/60">
      {stage === 'PUBLISH' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="created">Created date *</label>
            <input id="created" type="date" className={fieldCls} value={created} onChange={(e) => setCreated(e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="end">End date *</label>
            <input id="end" type="date" min={created} className={fieldCls} value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
      )}
      {stage === 'AWARD' && (
        <div>
          <label className={labelCls} htmlFor="amount">Final amount (₹) *</label>
          <input id="amount" type="number" inputMode="decimal" min="0" step="0.01" className={`${fieldCls} font-mono`}
            value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      )}
      {isCancel && (
        <div>
          <label className={labelCls} htmlFor="reason">Reason *</label>
          <textarea id="reason" rows={2} className={`${fieldCls} resize-none`} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      )}
      <div>
        <label className={labelCls} htmlFor="note">{isResolve ? 'Note *' : 'Note (optional)'}</label>
        {isResolve
          ? <textarea id="note" rows={2} className={`${fieldCls} resize-none`} value={note} onChange={(e) => setNote(e.target.value)} />
          : <input id="note" className={fieldCls} value={note} onChange={(e) => setNote(e.target.value)} />}
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={busy || missing}
          className={`flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-50 md:text-sm ${
            isCancel ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
          {busy && <Loader2 size={14} className="animate-spin" />} Confirm
        </button>
        <button type="button" onClick={onCancel}
          className="rounded-xl px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 md:text-sm">
          Back
        </button>
      </div>
    </form>
  );
}

export default function JeTenderControl() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(id ? parseInt(id, 10) : null);
  const [ticketDetails, setTicketDetails] = useState<TicketDetail | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [openAction, setOpenAction] = useState<string | null>(null);

  const fetchTenderTickets = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await api.get('/tickets/je/dashboard');
      const all: TicketSummary[] = res.data.tickets || [];
      const eligible = all.filter((t) => inGroup(POST_APPROVAL, t.status));
      setTickets(eligible);
      if (id) setSelectedTicketId(parseInt(id, 10));
      else setSelectedTicketId((cur) => cur ?? eligible[0]?.id ?? null);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not load your tickets.'));
    } finally {
      setLoadingList(false);
    }
  }, [id]);

  useEffect(() => { fetchTenderTickets(); }, [fetchTenderTickets]);

  const loadDetails = useCallback(async (ticketId: number) => {
    try {
      const res = await api.get(`/tickets/${ticketId}/details`);
      setTicketDetails(res.data.ticket);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not load the ticket.'));
    }
  }, []);

  useEffect(() => {
    if (!selectedTicketId) { setTicketDetails(null); return; }
    setLoadingDetails(true);
    loadDetails(selectedTicketId).finally(() => setLoadingDetails(false));
  }, [selectedTicketId, loadDetails]);

  const refresh = async () => {
    if (!selectedTicketId) return;
    await Promise.all([fetchTenderTickets(), loadDetails(selectedTicketId)]);
  };

  const offered = new Set((ticketDetails?.available_actions?.actions ?? []).map((a) => a.action));
  const canCancel = offered.has('TENDER_CANCEL');
  const afterStep = async () => { setOpenAction(null); await refresh(); };
  const currentIdx = ticketDetails ? STEPS.findIndex((m) => m.key === ticketDetails.status) : -1;
  const cancelled = ticketDetails?.status === 'TENDER_CANCELLED';
  // After a cancel the path is back at "approved" with a new publish to do.
  const reachedIdx = cancelled ? 0 : currentIdx;
  const awarded = ticketDetails?.tenders?.find((t) => t.status === 'AWARDED');
  const live = ticketDetails?.tenders?.filter((t) => t.status !== 'CANCELLED').at(-1);
  const estimate = ticketDetails?.report?.estimated_amount;

  if (loadingList) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-blue-600 dark:text-blue-400">
        <Loader2 className="animate-spin" size={38} />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 w-full pb-16 animate-in fade-in duration-300">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/je/dashboard')} aria-label="Back"
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-600 dark:text-slate-300">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white">Tenders</h1>
        </div>
        <button onClick={refresh}
          className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-200 dark:hover:bg-slate-600 transition">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {tickets.length === 0 ? (
        <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md rounded-2xl p-12 text-center border border-dashed border-slate-300 dark:border-slate-700 space-y-3">
          <Clock className="mx-auto text-slate-400" size={36} />
          <h3 className="font-bold text-slate-800 dark:text-slate-200 text-base">No tickets in tendering</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Tickets appear here once the approving officers have approved your inspection report.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 space-y-3">
            <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">Approved tickets ({tickets.length})</h3>
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {tickets.map((t) => {
                const isSelected = t.id === selectedTicketId;
                const amount = t.awarded_amount ?? t.estimated_amount;
                return (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => { setSelectedTicketId(t.id); navigate(`/je/tender/${t.id}`, { replace: true }); }}
                    className={`block w-full p-4 rounded-2xl border backdrop-blur-md text-left transition-all ${isSelected
                      ? 'bg-emerald-50/90 dark:bg-emerald-950/30 border-emerald-400 dark:border-emerald-600 shadow-sm ring-2 ring-emerald-500/20'
                      : 'bg-white/80 dark:bg-slate-800/80 border-slate-200/80 dark:border-slate-700/80 hover:border-slate-300'}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">{ticketNo(t.id)}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                        {staffStatusLabel(t.status)}
                      </span>
                    </div>
                    <h4 className="text-xs md:text-sm font-semibold text-slate-900 dark:text-white line-clamp-1">{t.title || t.description}</h4>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/60">
                      <span>{t.department} · {format(new Date(t.created_at), 'MMM dd')}</span>
                      {amount != null && <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{inr(amount)}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-8 space-y-6">
            {loadingDetails && !ticketDetails ? (
              <div className="flex h-64 items-center justify-center text-blue-600 dark:text-blue-400"><Loader2 className="animate-spin" size={32} /></div>
            ) : !ticketDetails ? (
              <div className="p-12 text-center bg-white/80 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-400">
                Select a ticket to manage its tender.
              </div>
            ) : (
              <div className="space-y-6">
                <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md rounded-2xl p-6 shadow-sm border border-slate-200/80 dark:border-slate-700/80 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-700/60">
                    <div>
                      <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">{ticketNo(ticketDetails.id)}</span>
                      <h2 className="text-base md:text-lg font-bold text-slate-900 dark:text-white mt-1">{ticketDetails.title || ticketDetails.description}</h2>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {estimate != null && (
                        <div className="px-3.5 py-1.5 rounded-xl bg-slate-500/10 border border-slate-500/20 text-slate-700 dark:text-slate-300 font-mono font-bold text-sm flex items-center gap-1.5">
                          <span className="text-[10px] font-sans uppercase text-slate-400">Estimate</span> {inr(estimate)}
                        </div>
                      )}
                      {awarded?.work_order_value != null && (
                        <div className="px-3.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-mono font-bold text-sm flex items-center gap-1.5">
                          <span className="text-[10px] font-sans uppercase">Final</span> {inr(awarded.work_order_value)}
                        </div>
                      )}
                    </div>
                  </div>

                  {cancelled && (
                    <p className="rounded-lg bg-rose-50 p-3 text-xs font-medium text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
                      The tender was cancelled. Mark it as published again.
                    </p>
                  )}

                  <div className="space-y-2">
                    {STEPS.map((m, idx) => {
                      const done = reachedIdx > idx;
                      const current = !cancelled && currentIdx === idx;
                      const nextAction = m.next && offered.has(m.next) && (m.next !== 'RESOLVE' || ticketDetails.status === 'WORK_IN_PROGRESS') ? m.next : null;
                      const dates = m.key === 'TENDER_PUBLISHED' && live?.published_date && reachedIdx >= idx
                        ? `${fmtDate(live.published_date)} to ${fmtDate(live.bid_end_date)}` : '';
                      return (
                        <div key={m.key} className={`p-3 rounded-xl border ${current
                          ? 'bg-blue-50/80 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700'
                          : done || (reachedIdx >= idx) ? 'bg-emerald-50/40 dark:bg-emerald-950/10 border-emerald-200/70 dark:border-emerald-900/40'
                            : 'bg-slate-50/50 dark:bg-slate-900/20 border-slate-200/60 dark:border-slate-700/60'}`}>
                          <div className="flex items-center gap-3">
                            {reachedIdx >= idx
                              ? <CheckCircle2 size={18} className={current ? 'text-blue-600' : 'text-emerald-600'} />
                              : <Circle size={18} className="text-slate-300 dark:text-slate-600" />}
                            <div className="min-w-0 flex-1">
                              <h4 className={`text-xs md:text-sm font-bold ${reachedIdx >= idx || nextAction ? 'text-slate-900 dark:text-white' : 'text-slate-400'}`}>{m.title}</h4>
                              {dates && <p className="text-xs text-slate-500 dark:text-slate-400">{dates}</p>}
                            </div>
                            {nextAction && openAction !== nextAction && (
                              <button type="button" onClick={() => setOpenAction(nextAction)}
                                className="rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700">
                                {m.button}
                              </button>
                            )}
                          </div>
                          {nextAction && openAction === nextAction && (
                            <NextStep key={`${ticketDetails.id}-${nextAction}`} ticketId={ticketDetails.id} action={nextAction}
                              estimate={estimate} onDone={afterStep} onCancel={() => setOpenAction(null)} />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {canCancel && (
                    openAction === 'TENDER_CANCEL' ? (
                      <NextStep key={`${ticketDetails.id}-cancel`} ticketId={ticketDetails.id} action="TENDER_CANCEL"
                        onDone={afterStep} onCancel={() => setOpenAction(null)} />
                    ) : (
                      <button type="button" onClick={() => setOpenAction('TENDER_CANCEL')}
                        className="text-xs font-semibold text-rose-600 hover:underline dark:text-rose-400">
                        Cancel tender
                      </button>
                    )
                  )}
                </div>

                <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md rounded-2xl p-6 shadow-sm border border-slate-200/80 dark:border-slate-700/80 space-y-4">
                  <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Documents</h3>
                  <GroupedAttachments files={ticketDetails.attachments ?? []} empty="No documents yet." />
                  {ticketDetails.status !== 'CLOSED' && ticketDetails.can_upload !== false && (
                    <UploadFiles ticketId={ticketDetails.id} label="Upload documents" onDone={() => loadDetails(ticketDetails.id)} />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
