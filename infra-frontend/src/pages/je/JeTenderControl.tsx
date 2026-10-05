import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  FileSpreadsheet, ArrowLeft, CheckCircle2, Clock, Wrench, CheckCheck, Loader2,
  Building2, IndianRupee, ArrowRight, ShieldCheck, RefreshCw, Gavel, ClipboardList, XCircle, Paperclip, X,
} from 'lucide-react';
import { api } from '../../services/api';
import { toast } from '../../store/toastStore';
import { GroupedAttachments, UploadFiles } from '../../components/ticket/Attachments';
import PostApproval from '../../components/ticket/PostApproval';
import type { TicketDetail } from '../../components/ticket/types';
import { errorMessage, staffStatusLabel, ticketNo, inr } from '../../lib/ticketUi';
import { checkFiles, loadUploadLimits, type UploadLimits } from '../../lib/uploadLimits';
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

const PORTALS = ['GeM', 'CPP Portal', 'State Tender'] as const;
const FILE_ACCEPT = '.jpg,.jpeg,.png,.webp,.heic,.pdf,.xlsx,.docx';
const today = () => new Date().toISOString().slice(0, 10);

const fieldCls =
  'w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs md:text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500';
const labelCls = 'block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wider';

// The stages of the path, in order. A cancelled tender is shown beside it, not in it.
const STEPS = [
  { key: 'APPROVED_FOR_TENDERING', title: 'Approved for tendering', desc: 'Approved. Publish the tender.', icon: ShieldCheck },
  { key: 'TENDER_PUBLISHED', title: 'Tender published', desc: 'Notice is live on the portal until the end date.', icon: FileSpreadsheet },
  { key: 'TECHNICAL_EVALUATION', title: 'Technical evaluation', desc: 'Technical bids are being evaluated.', icon: ClipboardList },
  { key: 'FINANCIAL_EVALUATION', title: 'Financial evaluation', desc: 'Financial bids are being evaluated.', icon: IndianRupee },
  { key: 'WORK_IN_PROGRESS', title: 'Awarded', desc: 'Work order issued. Site work is under way.', icon: Wrench },
  { key: 'WORK_COMPLETED', title: 'Resolved', desc: 'Marked resolved. The applicant verifies it, or sends it back.', icon: CheckCircle2 },
  { key: 'CLOSED', title: 'Closed', desc: 'The applicant confirmed. Ticket closed.', icon: CheckCheck },
] as const;

/** Files picked for one stage; limits come from the API. */
function FilePicker({ files, setFiles, limits }: { files: File[]; setFiles: (f: File[]) => void; limits: UploadLimits | null }) {
  return (
    <div>
      <span className={labelCls}>Attach documents (optional)</span>
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-white hover:bg-slate-900 dark:bg-slate-600">
        <Paperclip size={13} /> Add files
        <input type="file" multiple accept={FILE_ACCEPT} className="hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            e.target.value = '';
            setFiles([...files, ...picked].slice(0, limits?.attachment_files ?? 10));
          }} />
      </label>
      {files.map((f, i) => (
        <div key={`${f.name}-${i}`} className="mt-1.5 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800">
          <span className="min-w-0 truncate text-slate-700 dark:text-slate-300">{f.name}</span>
          <button type="button" aria-label="Remove file" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="ml-2 text-slate-400 hover:text-rose-600"><X size={13} /></button>
        </div>
      ))}
    </div>
  );
}

/** One form per stage the server offers (available_actions): publish, technical, financial, award, cancel. */
function StageForm({ ticketId, action, limits, onDone }: { ticketId: number; action: string; limits: UploadLimits | null; onDone: () => void }) {
  const stage = action.replace('TENDER_', '');
  const [v, setV] = useState({
    nit_number: '', portal_type: 'GeM', published_date: today(), bid_end_date: '', remarks: '',
    awarded_agency: '', award_amount: '', reason: '',
  });
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV((p) => ({ ...p, [k]: e.target.value }));

  const missing =
    stage === 'PUBLISH' ? !v.nit_number.trim() || !v.published_date || !v.bid_end_date || v.bid_end_date < v.published_date
      : stage === 'AWARD' ? !v.awarded_agency.trim() || !(Number(v.award_amount) > 0)
        : stage === 'CANCEL' ? !v.reason.trim() : false;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (missing) return;
    if (limits) {
      const tooBig = checkFiles(files, limits);
      if (tooBig) return toast.error(tooBig);
    }
    const fd = new FormData();
    fd.append('stage', stage);
    const send = (k: string, val: string) => { if (val.trim()) fd.append(k, val.trim()); };
    if (stage === 'PUBLISH') {
      send('nit_number', v.nit_number); fd.append('portal_type', v.portal_type);
      fd.append('published_date', v.published_date); fd.append('bid_end_date', v.bid_end_date);
    }
    if (stage === 'AWARD') { send('awarded_agency', v.awarded_agency); send('award_amount', v.award_amount); }
    if (stage === 'CANCEL') send('reason', v.reason);
    send('remarks', v.remarks);
    files.forEach((f) => fd.append('files', f));

    setBusy(true);
    try {
      const res = await api.post(`/tickets/${ticketId}/tender-stage`, fd);
      toast.success(res.data?.message || 'Updated.');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update the tender.'));
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      if (code === 'STAGE_NOT_ALLOWED' || code === 'CONFLICT') onDone(); // the ticket moved on: show it as it is
    } finally {
      setBusy(false);
    }
  };

  const TITLE: Record<string, string> = {
    PUBLISH: 'Publish tender', TECHNICAL: 'Start technical evaluation', FINANCIAL: 'Start financial evaluation',
    AWARD: 'Award the work', CANCEL: 'Cancel the tender',
  };
  const danger = stage === 'CANCEL';

  return (
    <form onSubmit={submit} className={`space-y-3 rounded-2xl border p-5 ${danger
      ? 'border-rose-200 bg-rose-50/50 dark:border-rose-900/50 dark:bg-rose-950/10'
      : 'border-slate-200/80 bg-white/80 dark:border-slate-700/80 dark:bg-slate-800/80'}`}>
      <h4 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
        {danger ? <XCircle size={15} className="text-rose-600" /> : <Gavel size={15} className="text-blue-600" />} {TITLE[stage]}
      </h4>

      {stage === 'PUBLISH' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor={`nit-${stage}`}>NIT / bid number *</label>
              <input id={`nit-${stage}`} className={fieldCls} value={v.nit_number} onChange={set('nit_number')} placeholder="e.g. GEM/2026/B/1234567" />
            </div>
            <div>
              <label className={labelCls} htmlFor={`portal-${stage}`}>Portal *</label>
              <select id={`portal-${stage}`} className={fieldCls} value={v.portal_type} onChange={set('portal_type')}>
                {PORTALS.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor={`created-${stage}`}>Created date *</label>
              <input id={`created-${stage}`} type="date" className={fieldCls} value={v.published_date} onChange={set('published_date')} />
            </div>
            <div>
              <label className={labelCls} htmlFor={`end-${stage}`}>End date *</label>
              <input id={`end-${stage}`} type="date" min={v.published_date} className={fieldCls} value={v.bid_end_date} onChange={set('bid_end_date')} />
            </div>
          </div>
        </>
      )}

      {stage === 'AWARD' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="agency">Awarded agency *</label>
            <input id="agency" className={fieldCls} value={v.awarded_agency} onChange={set('awarded_agency')} />
          </div>
          <div>
            <label className={labelCls} htmlFor="amount">Award amount (₹) *</label>
            <input id="amount" type="number" inputMode="decimal" min="0" step="0.01" className={`${fieldCls} font-mono`}
              value={v.award_amount} onChange={set('award_amount')} placeholder="e.g. 450000" />
          </div>
        </div>
      )}

      {stage === 'CANCEL' && (
        <div>
          <label className={labelCls} htmlFor="reason">Reason *</label>
          <textarea id="reason" rows={2} className={`${fieldCls} resize-none`} value={v.reason} onChange={set('reason')} placeholder="Why the tender is cancelled" />
        </div>
      )}

      <div>
        <label className={labelCls} htmlFor={`remarks-${stage}`}>Note (optional)</label>
        <input id={`remarks-${stage}`} className={fieldCls} value={v.remarks} onChange={set('remarks')} />
      </div>

      <FilePicker files={files} setFiles={setFiles} limits={limits} />

      <button type="submit" disabled={busy || missing}
        className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-xs font-bold text-white shadow-md transition disabled:cursor-not-allowed disabled:opacity-50 md:text-sm ${
          danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />} {TITLE[stage]}
      </button>
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
  const [limits, setLimits] = useState<UploadLimits | null>(null);

  useEffect(() => { loadUploadLimits().then(setLimits); }, []);

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

  const stageActions = (ticketDetails?.available_actions?.actions ?? []).filter((a) => a.action.startsWith('TENDER_'));
  const canResolve = (ticketDetails?.available_actions?.actions ?? []).some((a) => a.action === 'RESOLVE');
  const currentIdx = ticketDetails ? STEPS.findIndex((m) => m.key === ticketDetails.status) : -1;
  const cancelled = ticketDetails?.status === 'TENDER_CANCELLED';
  // After a cancel the path is back at "approved" with a new publish to do.
  const reachedIdx = cancelled ? 0 : currentIdx;
  const awarded = ticketDetails?.tenders?.find((t) => t.status === 'AWARDED');

  if (loadingList) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-blue-600 dark:text-blue-400">
        <Loader2 className="animate-spin" size={38} />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 w-full pb-16 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/80 dark:bg-slate-800/80 backdrop-blur-md p-5 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-700/80">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/je/dashboard')} aria-label="Back"
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-600 dark:text-slate-300">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
              <FileSpreadsheet className="text-emerald-600 dark:text-emerald-400" size={24} /> Tenders
            </h1>
            <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400">Publish, evaluate, award and resolve.</p>
          </div>
        </div>
        <button onClick={refresh}
          className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 self-start sm:self-center hover:bg-slate-200 dark:hover:bg-slate-600 transition">
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
                      {ticketDetails.report?.estimated_amount != null && (
                        <div className="px-3.5 py-1.5 rounded-xl bg-slate-500/10 border border-slate-500/20 text-slate-700 dark:text-slate-300 font-mono font-bold text-sm flex items-center gap-1.5">
                          <span className="text-[10px] font-sans uppercase text-slate-400">Estimate</span> {inr(ticketDetails.report.estimated_amount)}
                        </div>
                      )}
                      {awarded?.work_order_value != null && (
                        <div className="px-3.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-mono font-bold text-sm flex items-center gap-1.5">
                          <span className="text-[10px] font-sans uppercase">Awarded</span> {inr(awarded.work_order_value)}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Department</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1 mt-0.5"><Building2 size={13} className="text-blue-500" /> {ticketDetails.department}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Current stage</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5 block">{staffStatusLabel(ticketDetails.status)}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md rounded-2xl p-6 shadow-sm border border-slate-200/80 dark:border-slate-700/80 space-y-3">
                  <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Path</h3>
                  {cancelled && (
                    <p className="rounded-lg bg-rose-50 p-3 text-xs font-medium text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
                      The tender was cancelled. Publish it again, or mark the ticket resolved.
                    </p>
                  )}
                  <div className="space-y-2">
                    {STEPS.map((m, idx) => {
                      const reached = reachedIdx >= idx;
                      const current = !cancelled && currentIdx === idx;
                      const Icon = m.icon;
                      return (
                        <div key={m.key} className={`p-3 rounded-xl border flex items-start gap-3 ${current
                          ? 'bg-blue-50/80 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700 ring-1 ring-blue-500/20'
                          : reached ? 'bg-emerald-50/40 dark:bg-emerald-950/10 border-emerald-200/70 dark:border-emerald-900/40'
                            : 'bg-slate-50/50 dark:bg-slate-900/20 border-slate-200/60 dark:border-slate-700/60 opacity-60'}`}>
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${reached ? 'bg-emerald-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-400'}`}>
                            {reached && !current ? <CheckCircle2 size={16} /> : <Icon size={16} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <h4 className="text-xs md:text-sm font-bold text-slate-900 dark:text-white">{idx + 1}. {m.title}</h4>
                              {current && <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-blue-600 text-white">Now</span>}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{m.desc}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <PostApproval ticket={ticketDetails} />

                <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md rounded-2xl p-6 shadow-sm border border-slate-200/80 dark:border-slate-700/80 space-y-4">
                  <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Documents</h3>
                  <GroupedAttachments files={ticketDetails.attachments ?? []} empty="No documents yet." />
                  {ticketDetails.status !== 'CLOSED' && ticketDetails.can_upload !== false && (
                    <UploadFiles ticketId={ticketDetails.id} label="Upload work photos / docs" onDone={() => loadDetails(ticketDetails.id)} />
                  )}
                </div>

                {ticketDetails.status === 'WORK_COMPLETED' && (
                  <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 text-xs font-semibold">
                    Resolved. Waiting for the applicant to close it or send it back.
                  </div>
                )}

                {stageActions.map((a) => (
                  <StageForm key={`${ticketDetails.id}-${a.action}`} ticketId={ticketDetails.id} action={a.action} limits={limits} onDone={refresh} />
                ))}

                {canResolve && (
                  <button type="button" onClick={() => navigate(`/ticket/${ticketDetails.id}`)}
                    className="flex w-full items-center justify-between rounded-2xl border border-amber-300 bg-amber-50 p-4 text-left text-sm font-bold text-amber-800 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                    <span>Mark this ticket resolved<span className="block text-xs font-medium opacity-80">Opens the ticket, where you write the note and confirm.</span></span>
                    <ArrowRight size={16} />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
