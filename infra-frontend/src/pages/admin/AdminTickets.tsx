import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { 
  Search, ChevronLeft, ChevronRight, 
  RefreshCw, ShieldAlert, ArrowRight, X, Download, Filter as FilterIcon
} from 'lucide-react';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { toast } from '../../store/toastStore';
import ReassignFields from '../../components/admin/ReassignFields';
import { NO_REASSIGN, reassignBody, type ReassignValue } from '../../lib/reassign';
import { errorMessage, placeLabel, staffStatusLabel } from '../../lib/ticketUi';
import { ALL_STATUSES, inGroup, APPROVAL_STAGE, POST_APPROVAL } from '../../lib/statuses';

const TICKET_DEPARTMENTS = ['Civil', 'Electrical', 'Horticulture'];
const CAMPUSES = ['NORTH', 'SOUTH'];
const PRIORITIES = ['LOW', 'NORMAL', 'URGENT'];
const selectCls = 'px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-200 focus:outline-none';

interface TicketItem {
  id: number;
  title: string | null;
  department: string;
  campus?: string | null;
  landmark?: string | null;
  building?: string | null;
  type: string;
  priority?: string;
  description: string;
  location: string | null;
  status: string;
  created_at: string;
  applicant_name: string;
  applicant_email: string;
  applicant_phone?: string;
  je_name: string | null;
  je_email: string | null;
  current_holder_name?: string | null;
  estimated_amount: number | null;
  nature_of_work: string | null;
  attachment_count: number;
}

export default function AdminTickets() {
  const isDemo = useAuthStore((s) => !!s.user?.is_demo); // the demo Sysadmin is read-only
  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  // The filters live in the URL, so a filtered view survives a reload and can be shared.
  const [sp, setSp] = useSearchParams();
  const status = (sp.get('status') ?? '').split(',').filter(Boolean);
  const department = sp.get('department') ?? '';
  const campus = sp.get('campus') ?? '';
  const priority = sp.get('priority') ?? '';
  const type = sp.get('type') ?? '';
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const q = sp.get('q') ?? '';
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const limit = 20;
  const [searchDraft, setSearchDraft] = useState(q);
  const [exporting, setExporting] = useState(false);

  const update = (patch: Record<string, string | undefined>) =>
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
      if (!('page' in patch)) next.delete('page'); // a new filter starts at page 1
      return next;
    }, { replace: true });
  const setPage = (n: number) => update({ page: n > 1 ? String(n) : undefined });
  const applySearch = () => update({ q: searchDraft.trim() || undefined });
  const toggleStatus = (s: string) =>
    update({ status: (status.includes(s) ? status.filter((x) => x !== s) : [...status, s]).join(',') || undefined });
  const hasFilters = !!(q || status.length || department || campus || priority || type || from || to);
  const clearFilters = () => { setSearchDraft(''); setSp({}, { replace: true }); };
  useEffect(() => { setSearchDraft(q); }, [q]);

  /** Same parameter names the list and the export both take (one filter on the server). */
  const apiParams = () => {
    const p: Record<string, string> = {};
    if (q) p.search = q;
    if (status.length) p.status = status.join(',');
    if (department) p.department = department;
    if (campus) p.campus = campus;
    if (priority) p.priority = priority;
    if (type) p.type = type;
    if (from) p.created_from = from;
    if (to) p.created_to = to;
    return p;
  };

  // Override modal state
  const [selectedTicket, setSelectedTicket] = useState<TicketItem | null>(null);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideStatus, setOverrideStatus] = useState('');
  const [overridePriority, setOverridePriority] = useState('NORMAL');
  const [reassign, setReassign] = useState<ReassignValue>(NO_REASSIGN);
  const [overrideRemarks, setOverrideRemarks] = useState('');
  const [isSubmittingOverride, setIsSubmittingOverride] = useState(false);

  const filterKey = sp.toString();
  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/tickets', { params: { ...apiParams(), page, limit } });
      if (res.data.success) {
        setTickets(res.data.tickets || []);
        setTotal(res.data.total || 0);
      }
    } catch (err) {
      toast.error(errorMessage(err, 'Could not load tickets.'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await api.get('/admin/tickets/export', { params: apiParams(), responseType: 'blob' });
      const name = /filename="([^"]+)"/.exec(String(res.headers['content-disposition'] ?? ''))?.[1] ?? 'tickets.csv';
      const href = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = href; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (err) {
      // A blob response hides the JSON error body: read it.
      const blob = (err as { response?: { data?: Blob } })?.response?.data;
      let message = 'Could not export the tickets.';
      if (blob && typeof blob.text === 'function') {
        try { message = JSON.parse(await blob.text()).message || message; } catch { /* keep the generic text */ }
      }
      toast.error(message);
    } finally {
      setExporting(false);
    }
  };

  const handleOpenOverride = (t: TicketItem) => {
    setSelectedTicket(t);
    setOverrideStatus(t.status);
    setOverridePriority(t.priority ?? 'NORMAL');
    setReassign(NO_REASSIGN);
    setOverrideRemarks('');
    setOverrideModalOpen(true);
  };

  const handleExecuteOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket) return;
    if (!overrideRemarks.trim()) {
      toast.error('Enter a reason.');
      return;
    }

    setIsSubmittingOverride(true);
    try {
      const res = await api.post(`/admin/tickets/${selectedTicket.id}/override`, {
        new_status: overrideStatus !== selectedTicket.status ? overrideStatus : undefined,
        priority: overridePriority !== (selectedTicket.priority ?? 'NORMAL') ? overridePriority : undefined,
        reassign: reassignBody(reassign),
        remarks: overrideRemarks.trim(),
      });
      if (res.data.success) {
        toast.success('Ticket updated.');
        setOverrideModalOpen(false);
        fetchTickets();
      }
    } catch (err: any) {
      console.error('Override error:', err);
      toast.error(errorMessage(err, 'Could not update the ticket.'));
    } finally {
      setIsSubmittingOverride(false);
    }
  };

  const getStatusBadge = (s: string) => {
    if (s === 'CLOSED') return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
    if (s === 'DENIED') return 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20';
    if (inGroup(APPROVAL_STAGE, s)) return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20';
    if (inGroup(POST_APPROVAL, s) && s !== 'CLOSED') {
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';
    }
    return 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20';
  };

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6 animate-in fade-in duration-200 pb-16">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div>
              <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white">
                Tickets
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                All tickets, with overrides.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchTickets}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700/60 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applySearch(); }}
              placeholder="Search by ID, title, applicant or location"
              className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs md:text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={applySearch}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition shadow-sm"
          >
            Search
          </button>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <details className="relative">
            <summary className={`${selectCls} cursor-pointer list-none select-none`}>
              {status.length ? `${status.length} status${status.length > 1 ? 'es' : ''}` : 'All statuses'}
            </summary>
            <div className="absolute z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-800">
              {ALL_STATUSES.map((s) => (
                <label key={s} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/50">
                  <input type="checkbox" checked={status.includes(s)} onChange={() => toggleStatus(s)} />
                  {staffStatusLabel(s)}
                </label>
              ))}
            </div>
          </details>

          <select value={department} onChange={(e) => update({ department: e.target.value || undefined })} className={selectCls} aria-label="Department">
            <option value="">All departments</option>
            {TICKET_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={campus} onChange={(e) => update({ campus: e.target.value || undefined })} className={selectCls} aria-label="Campus">
            <option value="">All campuses</option>
            {CAMPUSES.map((c) => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}
          </select>
          <select value={priority} onChange={(e) => update({ priority: e.target.value || undefined })} className={selectCls} aria-label="Priority">
            <option value="">All priorities</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>)}
          </select>
          <select value={type} onChange={(e) => update({ type: e.target.value || undefined })} className={selectCls} aria-label="Type">
            <option value="">All types</option>
            <option value="recurring">Recurring</option>
            <option value="non-recurring">Proposals</option>
          </select>

          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            From
            <input type="date" value={from} max={to || undefined} onChange={(e) => update({ from: e.target.value || undefined })} className={selectCls} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            To
            <input type="date" value={to} min={from || undefined} onChange={(e) => update({ to: e.target.value || undefined })} className={selectCls} />
          </label>

          <div className="ml-auto flex items-center gap-2">
            {hasFilters && (
              <button onClick={clearFilters} className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700">
                <X size={14} /> Clear
              </button>
            )}
            <button
              onClick={exportCsv}
              disabled={exporting || total === 0}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition shadow-sm disabled:opacity-50"
            >
              <Download size={14} /> {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        </div>

        {hasFilters && (
          <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500 dark:text-slate-400">
            <FilterIcon size={12} />
            <span className="font-semibold">{total} ticket{total === 1 ? '' : 's'}</span>
            {q && <span>search "{q}"</span>}
            {status.length > 0 && <span>status {status.map(staffStatusLabel).join(', ')}</span>}
            {department && <span>{department}</span>}
            {campus && <span>{campus.toLowerCase()} campus</span>}
            {priority && <span>{priority.toLowerCase()} priority</span>}
            {type && <span>{type === 'recurring' ? 'recurring' : 'proposals'}</span>}
            {(from || to) && <span>{from || '…'} to {to || '…'}</span>}
          </p>
        )}
      </div>

      {/* Tickets List / Table */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">Loading…</div>
        ) : tickets.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            No tickets found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-900/30 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4">Ticket</th>
                  <th className="py-3 px-4">Work</th>
                  <th className="py-3 px-4">Applicant</th>
                  <th className="py-3 px-4">JE</th>
                  <th className="py-3 px-4">With</th>
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
                        {placeLabel(t)} · <span className="font-semibold text-slate-700 dark:text-slate-300">{t.department}</span> ({t.type})
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
                    <td className="py-3 px-4 whitespace-nowrap text-slate-700 dark:text-slate-300">
                      {t.current_holder_name || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">
                      {t.estimated_amount ? `₹${parseFloat(String(t.estimated_amount)).toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${getStatusBadge(t.status)}`}>
                        {staffStatusLabel(t.status)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                      {!isDemo && (
                      <button
                        onClick={() => handleOpenOverride(t)}
                        className="px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-semibold hover:bg-amber-100 transition"
                      >
                        Override
                      </button>
                      )}
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
          <span>Page {page} of {totalPages} · {total} tickets</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
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
                  <ShieldAlert className="text-amber-500" size={18} /> Override
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
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">New status</label>
                <select
                  value={overrideStatus}
                  onChange={(e) => setOverrideStatus(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  {ALL_STATUSES.map((s) => (
                    <option key={s} value={s}>{staffStatusLabel(s)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Priority</label>
                <select
                  value={overridePriority}
                  onChange={(e) => setOverridePriority(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</option>)}
                </select>
              </div>

              <ReassignFields department={selectedTicket.department} campus={selectedTicket.campus} value={reassign} onChange={setReassign} />

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Reason <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={3}
                  value={overrideRemarks}
                  onChange={(e) => setOverrideRemarks(e.target.value)}
                  placeholder="Why is this change needed?"
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
                  {isSubmittingOverride ? 'Applying…' : 'Apply'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
