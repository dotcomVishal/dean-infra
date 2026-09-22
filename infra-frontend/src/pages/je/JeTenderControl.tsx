import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  FileSpreadsheet, ArrowLeft, CheckCircle2,
  Clock, Wrench, CheckCheck, Loader2,
  Building2, IndianRupee, ArrowRight,
  ShieldCheck, RefreshCw
} from 'lucide-react';
import { api } from '../../services/api';

interface TicketSummary {
  id: number;
  title?: string;
  description: string;
  department: string;
  status: string;
  created_at: string;
  applicant_name?: string;
  estimated_amount?: number | string | null;
  nature_of_work?: string | null;
}

export default function JeTenderControl() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(id ? parseInt(id, 10) : null);
  const [ticketDetails, setTicketDetails] = useState<any>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Milestone Update State
  const [selectedMilestone, setSelectedMilestone] = useState<string>('');
  const [tenderRemarks, setTenderRemarks] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateMessage, setUpdateMessage] = useState('');

  // Fetch all tender-eligible tickets for the JE
  const fetchTenderTickets = async () => {
    setLoadingList(true);
    try {
      const res = await api.get('/tickets/je/dashboard');
      const all: TicketSummary[] = res.data.tickets || [];
      const tenderEligible = all.filter(
        (t) =>
          t.status === 'APPROVED_FOR_TENDERING' ||
          t.status === 'TENDER_PUBLISHED' ||
          t.status === 'WORK_IN_PROGRESS' ||
          t.status === 'CLOSED'
      );
      setTickets(tenderEligible);

      // If id param was in URL, ensure it's selected; otherwise select first if available
      if (id) {
        setSelectedTicketId(parseInt(id, 10));
      } else if (tenderEligible.length > 0 && !selectedTicketId) {
        setSelectedTicketId(tenderEligible[0].id);
      }
    } catch (err) {
      console.error('Failed to load tender tickets:', err);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    fetchTenderTickets();
  }, [id]);

  // When selectedTicketId changes, load its details
  useEffect(() => {
    if (!selectedTicketId) {
      setTicketDetails(null);
      return;
    }

    const loadDetails = async () => {
      setLoadingDetails(true);
      setUpdateMessage('');
      try {
        const res = await api.get(`/tickets/${selectedTicketId}/details`);
        setTicketDetails(res.data.ticket);

        // Pre-select the next sensible milestone
        const current = res.data.ticket?.status;
        if (current === 'APPROVED_FOR_TENDERING') setSelectedMilestone('TENDER_PUBLISHED');
        else if (current === 'TENDER_PUBLISHED') setSelectedMilestone('WORK_IN_PROGRESS');
        else if (current === 'WORK_IN_PROGRESS') setSelectedMilestone('CLOSED');
        else setSelectedMilestone('');
      } catch (err) {
        console.error('Failed to fetch ticket details:', err);
      } finally {
        setLoadingDetails(false);
      }
    };

    loadDetails();
  }, [selectedTicketId]);

  const handleMilestoneUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicketId || !selectedMilestone) return;

    setIsUpdating(true);
    setUpdateMessage('');

    try {
      const response = await api.post(`/tickets/${selectedTicketId}/tender`, {
        milestone: selectedMilestone,
        remarks: tenderRemarks.trim() || undefined,
      });

      if (response.data.success) {
        setUpdateMessage(`Milestone updated to ${selectedMilestone.replace(/_/g, ' ')}!`);
        setTenderRemarks('');

        // Refresh list and details
        await fetchTenderTickets();
        const res = await api.get(`/tickets/${selectedTicketId}/details`);
        setTicketDetails(res.data.ticket);
      }
    } catch (err: any) {
      console.error('Failed to update tender milestone:', err);
      alert(err.response?.data?.message || 'Milestone update failed.');
    } finally {
      setIsUpdating(false);
    }
  };

  const milestonesList = [
    {
      key: 'APPROVED_FOR_TENDERING',
      title: '1. Sanctioned for Tendering',
      desc: 'Sanctioned by authorities. Forwarded to Clerical Staff for GeM / CPP Portal tender publication.',
      icon: ShieldCheck,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-500/10',
    },
    {
      key: 'TENDER_PUBLISHED',
      title: '2. CPP / GeM Tender Published',
      desc: 'Tender notice published on CPP/GeM portal or NIT released. Technical bids undergoing evaluation.',
      icon: FileSpreadsheet,
      color: 'text-cyan-600 dark:text-cyan-400',
      bg: 'bg-cyan-500/10',
    },
    {
      key: 'WORK_IN_PROGRESS',
      title: '3. Work In Progress',
      desc: 'Work order executed with awarded agency. On-site physical construction/repair actively underway.',
      icon: Wrench,
      color: 'text-sky-600 dark:text-sky-400',
      bg: 'bg-sky-500/10',
    },
    {
      key: 'CLOSED',
      title: '4. Completed & Closed',
      desc: 'Work verified on site by JE. Completion certificate filed and ticket formally closed.',
      icon: CheckCheck,
      color: 'text-slate-700 dark:text-slate-300',
      bg: 'bg-slate-500/10',
    },
  ];

  const currentStatusIndex = ticketDetails
    ? milestonesList.findIndex((m) => m.key === ticketDetails.status)
    : -1;

  if (loadingList) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-blue-600 dark:text-blue-400">
        <Loader2 className="animate-spin" size={38} />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 w-full pb-16 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/80 dark:bg-slate-800/80 backdrop-blur-md p-5 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-700/80">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/je/dashboard')}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-600 dark:text-slate-300"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
              <FileSpreadsheet className="text-emerald-600 dark:text-emerald-400" size={24} />
              Tender & Execution Milestone Control
            </h1>
            <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400">
              Track external CPP / GeM tendering, physical progress, and formal closure
            </p>
          </div>
        </div>

        <button
          onClick={fetchTenderTickets}
          className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 self-start sm:self-center hover:bg-slate-200 dark:hover:bg-slate-600 transition"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {tickets.length === 0 ? (
        <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md rounded-2xl p-12 text-center border border-dashed border-slate-300 dark:border-slate-700 space-y-3">
          <Clock className="mx-auto text-slate-400" size={36} />
          <h3 className="font-bold text-slate-800 dark:text-slate-200 text-base">
            No Tickets in Tendering Stage
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Once inspection reports are sanctioned by higher authorities (SE, Dean, or Director), tickets will appear here for tendering milestone updates.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* TICKET SELECTOR SIDEBAR (4 COLS) */}
          <div className="lg:col-span-4 space-y-3">
            <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">
              Sanctioned Tickets ({tickets.length})
            </h3>
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {tickets.map((t) => {
                const isSelected = t.id === selectedTicketId;
                return (
                  <div
                    key={t.id}
                    onClick={() => {
                      setSelectedTicketId(t.id);
                      navigate(`/je/tender/${t.id}`, { replace: true });
                    }}
                    className={`p-4 rounded-2xl border backdrop-blur-md cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-emerald-50/90 dark:bg-emerald-950/30 border-emerald-400 dark:border-emerald-600 shadow-sm ring-2 ring-emerald-500/20'
                        : 'bg-white/80 dark:bg-slate-800/80 border-slate-200/80 dark:border-slate-700/80 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                        #TKT-{t.id.toString().padStart(4, '0')}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          t.status === 'CLOSED'
                            ? 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                            : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20'
                        }`}
                      >
                        {t.status === 'APPROVED_FOR_TENDERING'
                          ? 'Sanctioned'
                          : t.status === 'TENDER_PUBLISHED'
                          ? 'GeM/CPP Published'
                          : t.status === 'WORK_IN_PROGRESS'
                          ? 'In Progress'
                          : 'Closed'}
                      </span>
                    </div>

                    <h4 className="text-xs md:text-sm font-semibold text-slate-900 dark:text-white line-clamp-1">
                      {t.title || t.description}
                    </h4>
                    {t.title && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                        {t.description}
                      </p>
                    )}

                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/60">
                      <span>{t.department} · {format(new Date(t.created_at), 'MMM dd')}</span>
                      {t.estimated_amount && (
                        <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                          ₹{parseFloat(String(t.estimated_amount)).toLocaleString('en-IN')}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* DETAIL & MILESTONE UPDATE PANEL (8 COLS) */}
          <div className="lg:col-span-8 space-y-6">
            {loadingDetails ? (
              <div className="flex h-64 items-center justify-center text-blue-600 dark:text-blue-400">
                <Loader2 className="animate-spin" size={32} />
              </div>
            ) : !ticketDetails ? (
              <div className="p-12 text-center bg-white/80 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-400">
                Select a ticket to manage its tender milestones.
              </div>
            ) : (
              <div className="space-y-6">
                {/* Active Ticket Header Card */}
                <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md rounded-2xl p-6 shadow-sm border border-slate-200/80 dark:border-slate-700/80 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-700/60">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                          #TKT-{ticketDetails.id.toString().padStart(4, '0')}
                        </span>
                        {ticketDetails.type && (
                          <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                            {ticketDetails.type}
                          </span>
                        )}
                      </div>
                      <h2 className="text-base md:text-lg font-bold text-slate-900 dark:text-white mt-1">
                        {ticketDetails.title || ticketDetails.description}
                      </h2>
                      {ticketDetails.title && (
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 max-w-2xl">
                          {ticketDetails.description}
                        </p>
                      )}
                    </div>

                    {ticketDetails.report?.estimated_amount && (
                      <div className="px-3.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-mono font-bold text-sm flex items-center gap-1.5">
                        <IndianRupee size={16} />
                        {parseFloat(String(ticketDetails.report.estimated_amount)).toLocaleString('en-IN')}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Department</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1 mt-0.5">
                        <Building2 size={13} className="text-blue-500" /> {ticketDetails.department}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Current Stage</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5 block">
                        {ticketDetails.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Applicant</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5 block truncate">
                        {ticketDetails.applicant_name}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Milestone Stepper Visualizer */}
                <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md rounded-2xl p-6 shadow-sm border border-slate-200/80 dark:border-slate-700/80 space-y-4">
                  <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Execution Milestones
                  </h3>

                  <div className="space-y-3">
                    {milestonesList.map((m, idx) => {
                      const isReached = currentStatusIndex >= idx;
                      const isCurrent = currentStatusIndex === idx;
                      const Icon = m.icon;

                      return (
                        <div
                          key={m.key}
                          className={`p-4 rounded-xl border transition-all flex items-start gap-3.5 ${
                            isCurrent
                              ? 'bg-blue-50/80 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700 shadow-sm ring-1 ring-blue-500/20'
                              : isReached
                              ? 'bg-emerald-50/40 dark:bg-emerald-950/10 border-emerald-200/70 dark:border-emerald-900/40 opacity-90'
                              : 'bg-slate-50/50 dark:bg-slate-900/20 border-slate-200/60 dark:border-slate-700/60 opacity-60'
                          }`}
                        >
                          <div
                            className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                              isReached
                                ? 'bg-emerald-600 text-white shadow-sm'
                                : 'bg-slate-200 dark:bg-slate-700 text-slate-400'
                            }`}
                          >
                            {isReached && !isCurrent ? (
                              <CheckCircle2 size={18} />
                            ) : (
                              <Icon size={18} />
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <h4 className="text-xs md:text-sm font-bold text-slate-900 dark:text-white">
                                {m.title}
                              </h4>
                              {isCurrent && (
                                <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-blue-600 text-white">
                                  Current Milestone
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                              {m.desc}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Milestone Update Form */}
                {ticketDetails.status !== 'CLOSED' && (
                  <form
                    onSubmit={handleMilestoneUpdate}
                    className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md rounded-2xl p-6 shadow-sm border border-slate-200/80 dark:border-slate-700/80 space-y-4"
                  >
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <Wrench size={16} className="text-blue-600 dark:text-blue-400" />
                      Advance Tender / Execution Milestone
                    </h3>

                    {updateMessage && (
                      <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center gap-2">
                        <CheckCircle2 size={16} /> {updateMessage}
                      </div>
                    )}

                    <div className="space-y-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wider">
                          Select Next Milestone
                        </label>
                        <select
                          value={selectedMilestone}
                          onChange={(e) => setSelectedMilestone(e.target.value)}
                          className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs md:text-sm text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                        >
                          <option value="">-- Choose Milestone to Advance --</option>
                          {ticketDetails.status === 'APPROVED_FOR_TENDERING' && (
                            <option value="TENDER_PUBLISHED">
                              TENDER_PUBLISHED (CPP / GeM Portal Notice Published)
                            </option>
                          )}
                          {(ticketDetails.status === 'APPROVED_FOR_TENDERING' ||
                            ticketDetails.status === 'TENDER_PUBLISHED') && (
                            <option value="WORK_IN_PROGRESS">
                              WORK_IN_PROGRESS (Work Order Issued & Site Work Active)
                            </option>
                          )}
                          <option value="CLOSED">
                            CLOSED (Work Fully Completed & Inspected on Site)
                          </option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wider">
                          Milestone Remarks / Tender / GeM Reference Number
                        </label>
                        <input
                          type="text"
                          value={tenderRemarks}
                          onChange={(e) => setTenderRemarks(e.target.value)}
                          placeholder="e.g. GeM Bid ID: GEM/2026/B/..., Work Order #42..."
                          className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs md:text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={isUpdating || !selectedMilestone}
                        className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs md:text-sm shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isUpdating ? (
                          <>
                            <Loader2 size={16} className="animate-spin" />
                            Updating Milestone...
                          </>
                        ) : (
                          <>
                            <span>Update Milestone</span>
                            <ArrowRight size={16} />
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
