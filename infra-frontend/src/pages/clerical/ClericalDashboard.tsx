import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Search, RefreshCw, Loader2 } from 'lucide-react';
import { api } from '../../services/api';
import { staffStatusLabel, errorMessage, ticketNo, inr } from '../../lib/ticketUi';
import { toast } from '../../store/toastStore';

interface TenderTicket {
  id: number;
  title: string | null;
  description: string;
  department: string;
  type: string;
  status: string;
  created_at: string;
  applicant_name: string;
  applicant_email: string;
  applicant_phone?: string;
  estimated_amount: number | string | null;
  nature_of_work: string | null;
  nit_number?: string | null;
  portal_type?: string | null;
  awarded_agency?: string | null;
  work_order_value?: number | string | null;
  tender_status?: string | null;
}

export default function ClericalDashboard() {
  const [activeTab, setActiveTab] = useState<'awaiting_nit' | 'published' | 'in_progress' | 'all'>('awaiting_nit');
  const [tickets, setTickets] = useState<TenderTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const navigate = useNavigate();

  // Fetch Tickets
  const fetchTickets = async () => {
    setLoading(true);
    try {
      const res = await api.get('/tickets/queue', {
        params: {
          tab: activeTab,
          search: searchQuery.trim() || undefined
        }
      });
      if (res.data.success) {
        setTickets(res.data.tickets || []);
      }
    } catch (err) {
      toast.error(errorMessage(err, 'Could not load tickets.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, [activeTab]);

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6 animate-in fade-in duration-300 pb-16">
      
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white">Tenders</h1>
          <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-0.5">The assigned JE updates each stage.</p>
        </div>
        <button
          onClick={fetchTickets}
          className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-1 p-1.5 bg-slate-200/60 dark:bg-slate-800/60 backdrop-blur-md rounded-2xl border border-slate-200/80 dark:border-slate-700/80">
        <button
          onClick={() => setActiveTab('awaiting_nit')}
          className={`px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all ${
            activeTab === 'awaiting_nit'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          To publish
        </button>
        <button
          onClick={() => setActiveTab('published')}
          className={`px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all ${
            activeTab === 'published'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          In tendering
        </button>
        <button
          onClick={() => setActiveTab('in_progress')}
          className={`px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all ${
            activeTab === 'in_progress'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          Awarded
        </button>
        <button
          onClick={() => setActiveTab('all')}
          className={`px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all ${
            activeTab === 'all'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          All
        </button>
      </div>

      {/* Filter Bar */}
      <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchTickets()}
            placeholder="Search by ticket no. or title"
            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs md:text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={fetchTickets}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition shadow-sm"
        >
          Search
        </button>
      </div>

      {/* Tickets List */}
      {loading ? (
        <div className="flex justify-center p-12 text-blue-600 dark:text-blue-400"><Loader2 className="animate-spin" size={32} /></div>
      ) : tickets.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-slate-400">
          No tickets.
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/70 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 text-[11px] uppercase font-bold text-slate-400">
                  <th className="py-3 px-4">Ticket</th>
                  <th className="py-3 px-4">Title</th>
                  <th className="py-3 px-4">Department</th>
                  <th className="py-3 px-4">Approved Amount</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {tickets.map((t) => (
                  <tr key={t.id} onClick={() => navigate(`/ticket/${t.id}`)} className="cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-700/30 transition">
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="font-mono font-bold text-blue-600 dark:text-blue-400 block">
                        {ticketNo(t.id)}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {format(new Date(t.created_at), 'd MMM yyyy')}
                      </span>
                    </td>

                    <td className="py-3 px-4 max-w-xs">
                      <p className="font-bold text-slate-900 dark:text-white truncate">
                        {t.title || 'Untitled'}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">
                        {t.description}
                      </p>
                      {t.nit_number && (
                        <span className="inline-block mt-1 font-mono text-[10px] bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 px-1.5 py-0.5 rounded font-semibold">
                          NIT: {t.nit_number}
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 font-semibold text-[10px] text-slate-700 dark:text-slate-300">
                        {t.department}
                      </span>
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap font-mono font-bold text-slate-900 dark:text-white">
                      {inr(t.estimated_amount)}
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      {t.tender_status === 'AWARDED' ? (
                        <div>
                          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 block">
                            Awarded{t.awarded_agency ? `: ${t.awarded_agency}` : ''}
                          </span>
                          {t.work_order_value && (
                            <span className="font-mono text-[10px] text-slate-500">{inr(t.work_order_value)}</span>
                          )}
                        </div>
                      ) : t.status === 'TENDER_PUBLISHED' || t.status === 'TECHNICAL_EVALUATION' || t.status === 'FINANCIAL_EVALUATION' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border border-cyan-500/20">
                          {staffStatusLabel(t.status)}
                        </span>
                      ) : t.status === 'TENDER_CANCELLED' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20">
                          Cancelled
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                          To publish
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
