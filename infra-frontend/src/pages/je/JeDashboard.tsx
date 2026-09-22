import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  ClipboardCheck, Search, ArrowRight, PlusCircle,
  FileSpreadsheet, RefreshCw, Loader2, Building2
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { api } from '../../services/api';

export interface JeTicket {
  id: number;
  applicant_id: number;
  applicant_name: string;
  applicant_email?: string;
  applicant_phone?: string;
  department: string;
  title?: string;
  type: 'recurring' | 'non-recurring';
  description: string;
  location: string;
  status: string;
  created_at: string;
  estimated_amount?: number | string | null;
  nature_of_work?: string | null;
}

export default function JeDashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const [tickets, setTickets] = useState<JeTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'inspections' | 'approvals' | 'tenders'>('inspections');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'recurring' | 'non-recurring'>('all');

  const fetchJeTickets = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const response = await api.get('/tickets/je/dashboard');
      setTickets(response.data.tickets || []);
    } catch (err) {
      console.error('Failed to load JE tickets:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchJeTickets();
  }, [user]);

  // Tab 1: Pending Inspections (ASSIGNED_TO_JE, RETURNED_TO_JE)
  const pendingInspections = tickets.filter(
    (t) => t.status === 'ASSIGNED_TO_JE' || t.status === 'RETURNED_TO_JE'
  );

  // Tab 2: Awaiting Approval (PENDING_AE_APPROVAL, PENDING_SE_APPROVAL, PENDING_DEAN_APPROVAL, PENDING_DIRECTOR_APPROVAL)
  const awaitingApproval = tickets.filter((t) =>
    t.status.startsWith('PENDING_')
  );

  // Tab 3: Active Tenders (APPROVED_FOR_TENDERING, TENDER_PUBLISHED, WORK_IN_PROGRESS, CLOSED)
  const activeTenders = tickets.filter(
    (t) =>
      t.status === 'APPROVED_FOR_TENDERING' ||
      t.status === 'TENDER_PUBLISHED' ||
      t.status === 'WORK_IN_PROGRESS' ||
      t.status === 'CLOSED'
  );

  const getFilteredList = (list: JeTicket[]) => {
    const term = search.toLowerCase();
    return list.filter((ticket) => {
      const matchesSearch =
        (ticket.title && ticket.title.toLowerCase().includes(term)) ||
        ticket.description.toLowerCase().includes(term) ||
        ticket.id.toString().includes(term) ||
        ticket.applicant_name.toLowerCase().includes(term) ||
        (ticket.location && ticket.location.toLowerCase().includes(term));

      const matchesType = typeFilter === 'all' || ticket.type === typeFilter;
      return matchesSearch && matchesType;
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ASSIGNED_TO_JE':
        return (
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full border bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800/50">
            Pending Inspection
          </span>
        );
      case 'RETURNED_TO_JE':
        return (
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full border bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 border-red-200 dark:border-red-800/50">
            Returned for Revision
          </span>
        );
      case 'PENDING_AE_APPROVAL':
        return (
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full border bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400 border-blue-200 dark:border-blue-800/50">
            At AE Desk
          </span>
        );
      case 'PENDING_SE_APPROVAL':
        return (
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full border bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800/50">
            At SE Desk
          </span>
        );
      case 'PENDING_DEAN_APPROVAL':
        return (
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full border bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-400 border-purple-200 dark:border-purple-800/50">
            At Dean Desk
          </span>
        );
      case 'PENDING_DIRECTOR_APPROVAL':
        return (
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full border bg-pink-100 dark:bg-pink-900/30 text-pink-800 dark:text-pink-400 border-pink-200 dark:border-pink-800/50">
            At Director Desk
          </span>
        );
      case 'APPROVED_FOR_TENDERING':
        return (
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full border bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 border-green-200 dark:border-green-800/50">
            Sanctioned (Tendering)
          </span>
        );
      case 'TENDER_PUBLISHED':
        return (
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full border bg-cyan-100 dark:bg-cyan-900/30 text-cyan-800 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800/50">
            CPP/GeM Published
          </span>
        );
      case 'WORK_IN_PROGRESS':
        return (
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full border bg-sky-100 dark:bg-sky-900/30 text-sky-800 dark:text-sky-400 border-sky-200 dark:border-sky-800/50">
            Work In Progress
          </span>
        );
      case 'CLOSED':
        return (
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full border bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700">
            Closed
          </span>
        );
      default:
        return (
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full border bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700">
            {status.replace(/_/g, ' ')}
          </span>
        );
    }
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-blue-600 dark:text-blue-400">
        <Loader2 className="animate-spin" size={38} />
      </div>
    );
  }

  const currentDisplayList =
    activeTab === 'inspections'
      ? getFilteredList(pendingInspections)
      : activeTab === 'approvals'
      ? getFilteredList(awaitingApproval)
      : getFilteredList(activeTenders);

  return (
    <div className="max-w-6xl mx-auto space-y-8 w-full animate-fade-in">
      {/* HEADER (Clean Institutional Style) */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
            Junior Engineer Operations
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-medium">
            {user?.name} · {user?.department} Department
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchJeTickets(true)}
            disabled={refreshing}
            className="p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-600 dark:text-slate-300 transition-colors"
            title="Refresh tickets"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => navigate('/je/raise')}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-semibold shadow-sm transition-all flex items-center gap-2 text-sm justify-center active:scale-[0.98]"
          >
            <PlusCircle size={18} /> Raise Non-Recurring Proposal
          </button>
        </div>
      </div>

      {/* STAT CARDS (Matches Clean Dashboard Cards) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div
          onClick={() => setActiveTab('inspections')}
          className={`p-5 rounded-2xl border transition-all cursor-pointer ${
            activeTab === 'inspections'
              ? 'bg-amber-50/50 dark:bg-amber-900/10 border-amber-300 dark:border-amber-700/60 shadow-sm'
              : 'bg-white dark:bg-slate-800 border-gray-100 dark:border-slate-700 shadow-sm hover:border-slate-300 dark:hover:border-slate-600'
          }`}
        >
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <ClipboardCheck size={14} className="text-amber-500" /> Pending Inspections
            </span>
            {pendingInspections.some((t) => t.status === 'RETURNED_TO_JE') && (
              <span className="h-2 w-2 rounded-full bg-red-500" title="Revisions pending" />
            )}
          </div>
          <div className="text-3xl font-black text-slate-900 dark:text-white">
            {pendingInspections.length}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-medium">
            Requires field survey & estimate
          </div>
        </div>

        <div
          onClick={() => setActiveTab('approvals')}
          className={`p-5 rounded-2xl border transition-all cursor-pointer ${
            activeTab === 'approvals'
              ? 'bg-blue-50/50 dark:bg-blue-900/10 border-blue-300 dark:border-blue-700/60 shadow-sm'
              : 'bg-white dark:bg-slate-800 border-gray-100 dark:border-slate-700 shadow-sm hover:border-slate-300 dark:hover:border-slate-600'
          }`}
        >
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
            <Building2 size={14} className="text-blue-500" /> Awaiting Approval
          </div>
          <div className="text-3xl font-black text-slate-900 dark:text-white">
            {awaitingApproval.length}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-medium">
            In authority hierarchy review
          </div>
        </div>

        <div
          onClick={() => setActiveTab('tenders')}
          className={`p-5 rounded-2xl border transition-all cursor-pointer ${
            activeTab === 'tenders'
              ? 'bg-green-50/50 dark:bg-green-900/10 border-green-300 dark:border-green-700/60 shadow-sm'
              : 'bg-white dark:bg-slate-800 border-gray-100 dark:border-slate-700 shadow-sm hover:border-slate-300 dark:hover:border-slate-600'
          }`}
        >
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
            <FileSpreadsheet size={14} className="text-green-500" /> Active Tenders
          </div>
          <div className="text-3xl font-black text-slate-900 dark:text-white">
            {activeTenders.length}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-medium">
            Sanctioned & milestone tracking
          </div>
        </div>
      </div>

      {/* CONTROLS (Clean Institutional Toolbar) */}
      <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Tabs */}
          <div className="flex p-1 bg-slate-100 dark:bg-slate-900/60 rounded-xl">
            <button
              onClick={() => setActiveTab('inspections')}
              className={`px-4 py-2 text-xs md:text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'inspections'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <span>Pending Inspections</span>
              <span className="px-1.5 py-0.2 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 text-[10px] font-bold rounded-full">
                {pendingInspections.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('approvals')}
              className={`px-4 py-2 text-xs md:text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'approvals'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <span>Awaiting Approval</span>
              <span className="px-1.5 py-0.2 bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 text-[10px] font-bold rounded-full">
                {awaitingApproval.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('tenders')}
              className={`px-4 py-2 text-xs md:text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'tenders'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <span>Active Tenders</span>
              <span className="px-1.5 py-0.2 bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 text-[10px] font-bold rounded-full">
                {activeTenders.length}
              </span>
            </button>
          </div>

          {/* Search & Filter */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 md:w-64">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by title or ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-xs md:text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              />
            </div>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="py-2 px-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-xs md:text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium cursor-pointer"
            >
              <option value="all">All Types</option>
              <option value="recurring">Recurring</option>
              <option value="non-recurring">Non-Recurring</option>
            </select>
          </div>
        </div>
      </div>

      {/* TICKETS LIST */}
      <div className="space-y-3">
        {currentDisplayList.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 border border-dashed border-gray-200 dark:border-slate-700 rounded-2xl p-12 text-center text-slate-400 font-medium">
            No tickets found in this view.
          </div>
        ) : (
          currentDisplayList.map((ticket) => {
            const isReturned = ticket.status === 'RETURNED_TO_JE';
            const isTenderStage =
              ticket.status === 'APPROVED_FOR_TENDERING' ||
              ticket.status === 'TENDER_PUBLISHED' ||
              ticket.status === 'WORK_IN_PROGRESS';

            return (
              <div
                key={ticket.id}
                onClick={() =>
                  isTenderStage
                    ? navigate(`/je/tender/${ticket.id}`)
                    : navigate(`/je/ticket/${ticket.id}`)
                }
                className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl p-5 shadow-sm hover:border-slate-300 dark:hover:border-slate-600 transition-all cursor-pointer group"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                        #TKT-{ticket.id.toString().padStart(4, '0')}
                      </span>
                      {getStatusBadge(ticket.status)}
                      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                        {ticket.type}
                      </span>
                      <span className="text-xs text-slate-400">·</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                        {ticket.department} Dept.
                      </span>
                    </div>

                    <div>
                      <h3 className="text-sm md:text-base font-bold text-slate-900 dark:text-white line-clamp-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {ticket.title || ticket.description}
                      </h3>
                      {ticket.title && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">
                          {ticket.description}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400 pt-1">
                      <span>Applicant: <strong className="text-slate-700 dark:text-slate-300">{ticket.applicant_name}</strong></span>
                      {ticket.location && <span>Location: <span className="italic">{ticket.location}</span></span>}
                      <span>Reported: {format(new Date(ticket.created_at), 'MMM dd, yyyy')}</span>
                      {ticket.estimated_amount && (
                        <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                          Estimate: ₹{parseFloat(String(ticket.estimated_amount)).toLocaleString('en-IN')}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    {activeTab === 'inspections' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/je/ticket/${ticket.id}`);
                        }}
                        className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                          isReturned
                            ? 'bg-red-600 text-white hover:bg-red-700 shadow-sm'
                            : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                        }`}
                      >
                        {isReturned ? 'Revise Inspection' : 'Inspect & Report'}
                        <ArrowRight size={14} />
                      </button>
                    )}

                    {activeTab === 'approvals' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/je/ticket/${ticket.id}`);
                        }}
                        className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition"
                      >
                        View Status
                        <ArrowRight size={14} />
                      </button>
                    )}

                    {activeTab === 'tenders' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/je/tender/${ticket.id}`);
                        }}
                        className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 text-xs font-semibold flex items-center gap-1.5 shadow-sm transition"
                      >
                        Tender Control
                        <ArrowRight size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
