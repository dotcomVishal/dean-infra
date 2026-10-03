import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { 
  ClipboardList, Search, ChevronLeft, ChevronRight, 
  RefreshCw, ShieldAlert, ArrowRight, X, Download
} from 'lucide-react';
import { api } from '../../services/api';
import { toast } from '../../store/toastStore';
import ReassignFields from '../../components/admin/ReassignFields';
import { NO_REASSIGN, reassignBody, type ReassignValue } from '../../lib/reassign';
import { ALL_STATUSES, errorMessage, isPostApproval, staffStatusLabel } from '../../lib/ticketUi';


const TICKET_DEPARTMENTS = ['Civil', 'Electrical', 'Horticulture'];

interface TicketItem {
  id: number;
  title: string | null;
  department: string;
  campus?: string | null;
  type: string;
  description: string;
  landmark: string | null;
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
  priority?: string | null;
  deleted_at?: string | null;
  is_mock?: boolean | number;
}

export default function AdminTickets() {
  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  // Filter state lives in the URL query string, so a filtered view can be bookmarked and shared.
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const statuses = (params.get('status') ?? '').split(',').filter(Boolean);
  const campus = params.get('campus') ?? '';
  const dept = params.get('department') ?? '';
  const priority = params.get('priority') ?? '';
  const typeF = params.get('type') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const mock = params.get('mock') === '1';
  const deleted = params.get('deleted') === '1';
  const preset = params.get('preset') ?? '';
  const page = parseInt(params.get('page') ?? '1', 10) || 1;
  const [searchText, setSearchText] = useState(q);
  const [exporting, setExporting] = useState(false);
  const setFilter = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k); }
    if (!('page' in changes)) next.delete('page'); // any filter change goes back to page 1
    setParams(next, { replace: true });
  };
  const setPage = (n: number) => setFilter({ page: n > 1 ? String(n) : null });
  const limit = 20;

  // Override modal state
  const [selectedTicket, setSelectedTicket] = useState<TicketItem | null>(null);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideStatus, setOverrideStatus] = useState('');
  const [reassign, setReassign] = useState<ReassignValue>(NO_REASSIGN);
  const [overrideRemarks, setOverrideRemarks] = useState('');
  const [isSubmittingOverride, setIsSubmittingOverride] = useState(false);

  // The same parameters feed the list and the CSV, so the file equals what is on screen.
  const filterParams = () => {
    const p: Record<string, string> = {};
    if (q.trim()) p.search = q.trim();
    if (statuses.length) p.status = statuses.join(',');
    if (campus) p.campus = campus;
    if (dept) p.department = dept;
    if (priority) p.priority = priority;
    if (typeF) p.type = typeF;
    if (from) p.from = from;
    if (to) p.to = to;
    if (mock) p.include_mock = '1';
    if (deleted) p.include_deleted = '1';
    if (preset === 'confirm') p.awaiting_confirmation = '1';
    if (preset === 'sent_back') p.sent_back = '1';
    return p;
  };

  const fetchTickets = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/tickets', { params: { ...filterParams(), page, limit } });
      if (res.data.success) {
        setTickets(res.data.tickets || []);
        setTotal(res.data.total || 0);
      }
    } catch (err) {
      toast.error(errorMessage(err, 'Could not load the tickets.'));
    } finally {
      setLoading(false);
    }
  };

  // The endpoint needs the bearer token, so the file is fetched through axios and saved from a blob.
  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await api.get('/admin/tickets/export.csv', { params: filterParams(), responseType: 'blob' });
      const href = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `tickets-${format(new Date(), 'yyyyMMdd')}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (err) {
      // An error body arrives as a blob: read the server's message out of it.
      const blob = (err as { response?: { data?: Blob } })?.response?.data;
      let message = errorMessage(err, 'Could not export the tickets.');
      if (blob instanceof Blob) {
        try { message = JSON.parse(await blob.text()).message ?? message; } catch { /* keep the generic message */ }
      }
      toast.error(message);
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpenOverride = (t: TicketItem) => {
    setSelectedTicket(t);
    setOverrideStatus(t.status);
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
      toast.error(err.response?.data?.message || 'Could not update the ticket.');
    } finally {
      setIsSubmittingOverride(false);
    }
  };

  const getStatusBadge = (s: string) => {
    if (s === 'CLOSED') return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
    if (s === 'DENIED') return 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20';
    if (s.startsWith('PENDING_')) return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20';
    if (isPostApproval(s)) {
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
            onClick={() => fetchTickets()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700/60 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-700/80 dark:bg-slate-800">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => { e.preventDefault(); setFilter({ q: searchText.trim() || null }); }}
        >
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search by ID, title, applicant or landmark"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-4 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white md:text-sm"
            />
          </div>
          <button type="submit" className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700">Search</button>
        </form>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-7">
          <details className="relative col-span-2 md:col-span-1">
            <summary className="cursor-pointer list-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              {statuses.length ? `${statuses.length} status${statuses.length > 1 ? 'es' : ''}` : 'All statuses'}
            </summary>
            <div className="absolute z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-800">
              {ALL_STATUSES.map((st) => (
                <label key={st} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-700/60">
                  <input type="checkbox" checked={statuses.includes(st)}
                    onChange={() => setFilter({ status: (statuses.includes(st) ? statuses.filter((x) => x !== st) : [...statuses, st]).join(',') || null })} />
                  {staffStatusLabel(st)}
                </label>
              ))}
            </div>
          </details>
          <select aria-label="Campus" value={campus} onChange={(e) => setFilter({ campus: e.target.value || null })}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <option value="">All campuses</option><option value="NORTH">North</option><option value="SOUTH">South</option>
          </select>
          <select aria-label="Department" value={dept} onChange={(e) => setFilter({ department: e.target.value || null })}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <option value="">All departments</option>
            {TICKET_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select aria-label="Priority" value={priority} onChange={(e) => setFilter({ priority: e.target.value || null })}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <option value="">All priorities</option><option value="URGENT">Urgent</option><option value="NORMAL">Normal</option><option value="LOW">Low</option>
          </select>
          <select aria-label="Type" value={typeF} onChange={(e) => setFilter({ type: e.target.value || null })}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <option value="">All types</option><option value="recurring">Recurring</option><option value="non-recurring">Proposals</option>
          </select>
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">From
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFilter({ from: e.target.value || null })}
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white" /></label>
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">To
            <input type="date" value={to} min={from || undefined} onChange={(e) => setFilter({ to: e.target.value || null })}
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white" /></label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600 dark:text-slate-300">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={mock} onChange={(e) => setFilter({ mock: e.target.checked ? '1' : null })} /> Test tickets</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={deleted} onChange={(e) => setFilter({ deleted: e.target.checked ? '1' : null })} /> Show deleted</label>
            <select aria-label="Section" value={preset} onChange={(e) => setFilter({ preset: e.target.value || null })}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900">
              <option value="">Any stage</option><option value="confirm">Resolved, awaiting confirmation</option><option value="sent_back">Sent back</option>
            </select>
            {params.toString() !== '' && (
              <button type="button" onClick={() => { setSearchText(''); setParams(new URLSearchParams(), { replace: true }); }}
                className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline dark:text-blue-400"><X size={12} /> Clear filters</button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{total} matching</span>
            <button type="button" onClick={exportCsv} disabled={exporting || total === 0}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50">
              <Download size={14} className={exporting ? 'animate-pulse' : ''} /> Export CSV
            </button>
          </div>
        </div>
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
                        {t.deleted_at && <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">Deleted</span>}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">
                        {t.landmark || 'Campus'} · <span className="font-semibold text-slate-700 dark:text-slate-300">{t.department}</span> ({t.type})
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
                    <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                  ))}
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
