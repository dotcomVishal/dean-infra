import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { FileSpreadsheet, ArrowLeft, Clock, Loader2, RefreshCw, ExternalLink } from 'lucide-react';
import { api } from '../../services/api';
import { toast } from '../../store/toastStore';
import { GroupedAttachments, UploadFiles } from '../../components/ticket/Attachments';
import LifecyclePanel from '../../components/ticket/LifecyclePanel';
import { Card } from '../../components/ticket/Card';
import { errorMessage, isPostApproval, staffStatusLabel, ticketNo } from '../../lib/ticketUi';
import type { TicketDetail } from '../../components/ticket/types';

interface TicketSummary {
  id: number;
  title?: string;
  description: string;
  department: string;
  status: string;
  created_at: string;
  estimated_amount?: number | string | null;
}

/** The JE's tenders: each ticket after approval, with its tender steps and Resolve (driven by the server's rules). */
export default function JeTenderControl() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(id ? parseInt(id, 10) : null);
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await api.get('/tickets/je/dashboard');
      const all: TicketSummary[] = res.data.tickets || [];
      const post = all.filter((t) => isPostApproval(t.status));
      setTickets(post);
      setSelectedId((cur) => cur ?? post[0]?.id ?? null);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not load your tenders.'));
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadDetails = useCallback(async (ticketId: number) => {
    setLoadingDetails(true);
    try {
      const res = await api.get(`/tickets/${ticketId}/details`);
      setTicket(res.data.ticket);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not load the ticket.'));
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList, id]);
  useEffect(() => {
    if (id) setSelectedId(parseInt(id, 10));
  }, [id]);
  useEffect(() => {
    if (selectedId) loadDetails(selectedId); else setTicket(null);
  }, [selectedId, loadDetails]);

  const refresh = async () => {
    await loadList();
    if (selectedId) await loadDetails(selectedId);
  };

  if (loadingList) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-blue-600 dark:text-blue-400">
        <Loader2 className="animate-spin" size={38} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-16 animate-in fade-in duration-300">
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-800/80 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/je/dashboard')} aria-label="Back"
            className="rounded-full p-2 text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="flex items-center gap-2 text-xl font-black text-slate-900 dark:text-white md:text-2xl">
              <FileSpreadsheet className="text-emerald-600 dark:text-emerald-400" size={24} /> Tenders
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 md:text-sm">Tender, award and resolution.</p>
          </div>
        </div>
        <button onClick={refresh}
          className="flex items-center gap-1.5 self-start rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 sm:self-center">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {tickets.length === 0 ? (
        <div className="space-y-3 rounded-2xl border border-dashed border-slate-300 bg-white/80 p-12 text-center dark:border-slate-700 dark:bg-slate-800/80">
          <Clock className="mx-auto text-slate-400" size={36} />
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">No tickets in the tender stage</h3>
          <p className="mx-auto max-w-md text-xs text-slate-500">
            Once the approving desks approve your reports, the tickets appear here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-3 lg:col-span-4">
            <h3 className="px-1 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Approved tickets ({tickets.length})
            </h3>
            <div className="max-h-[600px] space-y-2 overflow-y-auto pr-1">
              {tickets.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => { setSelectedId(t.id); navigate(`/je/tender/${t.id}`, { replace: true }); }}
                  className={`w-full rounded-2xl border p-4 text-left transition-all ${
                    t.id === selectedId
                      ? 'border-emerald-400 bg-emerald-50/90 shadow-sm ring-2 ring-emerald-500/20 dark:border-emerald-600 dark:bg-emerald-950/30'
                      : 'border-slate-200/80 bg-white/80 hover:border-slate-300 dark:border-slate-700/80 dark:bg-slate-800/80'
                  }`}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">{ticketNo(t.id)}</span>
                    <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                      {staffStatusLabel(t.status)}
                    </span>
                  </div>
                  <h4 className="line-clamp-1 text-xs font-semibold text-slate-900 dark:text-white md:text-sm">{t.title || t.description}</h4>
                  <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-500 dark:border-slate-700/60 dark:text-slate-400">
                    <span>{t.department} · {format(new Date(t.created_at), 'MMM dd')}</span>
                    {t.estimated_amount != null && (
                      <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                        ₹{parseFloat(String(t.estimated_amount)).toLocaleString('en-IN')}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-6 lg:col-span-8">
            {loadingDetails && !ticket ? (
              <div className="flex h-64 items-center justify-center text-blue-600 dark:text-blue-400"><Loader2 className="animate-spin" size={32} /></div>
            ) : !ticket ? (
              <div className="rounded-2xl border border-slate-200 bg-white/80 p-12 text-center text-slate-400 dark:border-slate-700 dark:bg-slate-800/80">
                Select a ticket.
              </div>
            ) : (
              <>
                <Card>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">{ticketNo(ticket.id)}</span>
                    <button type="button" onClick={() => navigate(`/je/ticket/${ticket.id}`)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400">
                      <ExternalLink size={12} /> Full ticket
                    </button>
                  </div>
                  <h2 className="mt-1 text-base font-bold text-slate-900 dark:text-white md:text-lg">{ticket.title || ticket.description}</h2>
                  {ticket.title && <p className="mt-1 max-w-2xl text-xs text-slate-600 dark:text-slate-300">{ticket.description}</p>}
                  <p className="mt-2 text-xs font-semibold text-slate-500">{staffStatusLabel(ticket.status)}</p>
                </Card>

                <LifecyclePanel ticket={ticket} onDone={refresh} />

                {/* Only files not shown on the ticket page: applicant photos and report files live there. */}
                <Card title="Documents">
                  <GroupedAttachments
                    files={ticket.attachments.filter((a) => a.document_category && a.document_category !== 'APPLICANT_EVIDENCE' && a.report_id == null)}
                    empty="No documents yet."
                  />
                  {ticket.status !== 'CLOSED' && (
                    <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-700">
                      <UploadFiles ticketId={ticket.id} label="Upload work photos / docs" onDone={() => loadDetails(ticket.id)} />
                    </div>
                  )}
                </Card>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
