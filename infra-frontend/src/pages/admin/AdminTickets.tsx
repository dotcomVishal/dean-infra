import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { 
  ClipboardList, Search, ChevronLeft, ChevronRight, 
  RefreshCw, ShieldAlert, ArrowRight, X
} from 'lucide-react';
import { api } from '../../services/api';

const ALL_STATUSES = [
  'ASSIGNED_TO_JE',
  'PENDING_AE_APPROVAL',
  'PENDING_SE_APPROVAL',
  'PENDING_DEAN_APPROVAL',
  'PENDING_DIRECTOR_APPROVAL',
  'APPROVED_FOR_TENDERING',
  'TENDER_PUBLISHED',
  'WORK_IN_PROGRESS',
  'RETURNED_TO_JE',
  'DENIED',
  'CLOSED'
];

const TICKET_DEPARTMENTS = ['Civil', 'Electrical', 'Horticulture'];

interface TicketItem {
  id: number;
  title: string | null;
  department: string;
  type: string;
  description: string;
  location: string | null;
  status: string;
  created_at: string;
  applicant_name: string;
  applicant_email: string;
  applicant_phone?: string;
  je_name: string | null;
  je_email: string | null;
  estimated_amount: number | null;
  nature_of_work: string | null;
  attachment_count: number;
}

interface JEItem {
  id: number;
  name: string;
  email: string;
  department: string;
}

export default function AdminTickets() {
  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  // Override modal state
  const [selectedTicket, setSelectedTicket] = useState<TicketItem | null>(null);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideStatus, setOverrideStatus] = useState('');
  const [overrideJeId, setOverrideJeId] = useState('');
  const [overrideRemarks, setOverrideRemarks] = useState('');
  const [isSubmittingOverride, setIsSubmittingOverride] = useState(false);
  const [jes, setJes] = useState<JEItem[]>([]);

  const fetchTickets = async () => {
    setLoading(true);
    try {
      const params: any = { page, limit };
      if (search.trim()) params.search = search.trim();
      if (statusFilter && statusFilter !== 'ALL') params.status = statusFilter;
      if (deptFilter && deptFilter !== 'ALL') params.department = deptFilter;
      if (typeFilter && typeFilter !== 'ALL') params.type = typeFilter;

      const res = await api.get('/admin/tickets', { params });
      if (res.data.success) {
        setTickets(res.data.tickets || []);
        setTotal(res.data.total || 0);
      }
    } catch (err) {
      console.error('Failed to load tickets:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchJes = async () => {
    try {
      const res = await api.get('/admin/jes');
      if (res.data.success) {
        setJes(res.data.jes || []);
      }
    } catch (err) {
      console.error('Failed to load JEs directory:', err);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, [page, statusFilter, deptFilter, typeFilter]);

  useEffect(() => {
    fetchJes();
  }, []);

  const handleOpenOverride = (t: TicketItem) => {
    setSelectedTicket(t);
    setOverrideStatus(t.status);
    setOverrideJeId('');
    setOverrideRemarks('');
    setOverrideModalOpen(true);
  };

  const handleExecuteOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket) return;
    if (!overrideRemarks.trim()) {
      alert('Administrative justification remarks are strictly mandatory.');
      return;
    }

    setIsSubmittingOverride(true);
    try {
      const res = await api.post(`/admin/tickets/${selectedTicket.id}/override`, {
        new_status: overrideStatus !== selectedTicket.status ? overrideStatus : undefined,
        new_assigned_je_id: overrideJeId ? parseInt(overrideJeId, 10) : undefined,
        remarks: overrideRemarks.trim(),
      });
      if (res.data.success) {
        alert('Ticket state and audit trail updated successfully.');
        setOverrideModalOpen(false);
        fetchTickets();
      }
    } catch (err: any) {
      console.error('Override error:', err);
      alert(err.response?.data?.message || 'Failed to execute override.');
    } finally {
      setIsSubmittingOverride(false);
    }
  };

  const getStatusBadge = (s: string) => {
    if (s === 'CLOSED') return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
    if (s === 'DENIED') return 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20';
    if (s.startsWith('PENDING_')) return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20';
    if (s === 'APPROVED_FOR_TENDERING' || s === 'TENDER_PUBLISHED' || s === 'WORK_IN_PROGRESS') {
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';
    }
    return 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20';
  };

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6 animate-in fade-in duration-200 pb-16">
      
      {/* Header */}
      <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md p-6 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-700/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              <ClipboardList size={22} />
            </span>
            <div>
              <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white">
                Master Tickets Directory
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Centralized oversight and administrative override controls across all campus works
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => { setPage(1); fetchTickets(); }}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700/60 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm flex flex-col lg:flex-row gap-3 items-center justify-between">
        <div className="flex-1 w-full flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && { setPage: 1, fetchTickets }}
              placeholder="Search by ticket ID, title, description, applicant, location..."
              className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs md:text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-200 focus:outline-none"
          >
            <option value="">All Statuses</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </select>

          <select
            value={deptFilter}
            onChange={(e) => { setDeptFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-200 focus:outline-none"
          >
            <option value="">All Departments</option>
            {TICKET_DEPARTMENTS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>

          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-200 focus:outline-none"
          >
            <option value="">All Work Types</option>
            <option value="recurring">Recurring Maintenance</option>
            <option value="non-recurring">Non-Recurring Proposals</option>
          </select>

          <button
            onClick={() => { setPage(1); fetchTickets(); }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition shadow-sm"
          >
            Filter
          </button>
        </div>
      </div>

      {/* Tickets List / Table */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">Loading tickets...</div>
        ) : tickets.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            No tickets match your search or filter criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-900/30 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4">Ticket</th>
                  <th className="py-3 px-4">Work Scope & Location</th>
                  <th className="py-3 px-4">Applicant</th>
                  <th className="py-3 px-4">Assigned JE</th>
                  <th className="py-3 px-4">Estimate</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {tickets.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-900/40 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-blue-600 dark:text-blue-400 whitespace-nowrap">
                      #TKT-{t.id.toString().padStart(4, '0')}
                      <span className="block text-[10px] text-slate-400 font-normal mt-0.5">
                        {format(new Date(t.created_at), 'dd MMM yyyy')}
                      </span>
                    </td>
                    <td className="py-3 px-4 max-w-xs">
                      <p className="font-bold text-slate-900 dark:text-white truncate">
                        {t.title || t.description.substring(0, 50)}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">
                        {t.location || 'Campus'} · <span className="font-semibold text-slate-700 dark:text-slate-300">{t.department}</span> ({t.type})
                      </p>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <p className="font-semibold text-slate-800 dark:text-slate-200">{t.applicant_name}</p>
                      <p className="text-[11px] text-slate-400 truncate">{t.applicant_email}</p>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {t.je_name ? (
                        <div>
                          <p className="font-semibold text-slate-800 dark:text-slate-200">{t.je_name}</p>
                          <p className="text-[11px] text-slate-400">{t.je_email}</p>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">Unassigned</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">
                      {t.estimated_amount ? `₹${parseFloat(String(t.estimated_amount)).toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${getStatusBadge(t.status)}`}>
                        {t.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                      <button
                        onClick={() => handleOpenOverride(t)}
                        className="px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-semibold hover:bg-amber-100 transition"
                      >
                        Override
                      </button>
                      <Link
                        to={`/admin/ticket/${t.id}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-semibold hover:bg-blue-100 transition"
                      >
                        Details <ArrowRight size={13} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Controls */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between text-xs text-slate-500">
          <span>Showing page {page} of {totalPages} ({total} tickets total)</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Admin Override Modal */}
      {overrideModalOpen && selectedTicket && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 dark:border-slate-700 space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <ShieldAlert className="text-amber-500" size={18} /> Administrative Override
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Ticket #TKT-{selectedTicket.id.toString().padStart(4, '0')}</p>
              </div>
              <button
                onClick={() => setOverrideModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleExecuteOverride} className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Force Status Transition</label>
                <select
                  value={overrideStatus}
                  onChange={(e) => setOverrideStatus(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  {ALL_STATUSES.map((s) => (
                    <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Reassign Responsible Junior Engineer <span className="font-normal text-slate-400">(Optional)</span>
                </label>
                <select
                  value={overrideJeId}
                  onChange={(e) => setOverrideJeId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="">Keep currently assigned JE ({selectedTicket.je_name || 'None'})</option>
                  {jes.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.name} ({j.department} Wing) — {j.email}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Mandatory Audit Justification / Remarks <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={3}
                  value={overrideRemarks}
                  onChange={(e) => setOverrideRemarks(e.target.value)}
                  placeholder="Specify official reason for administrative intervention (e.g. emergency requisition, authority delegation, technical reassignment)..."
                  required
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setOverrideModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingOverride}
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold transition disabled:opacity-50"
                >
                  {isSubmittingOverride ? 'Executing...' : 'Commit Override'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
