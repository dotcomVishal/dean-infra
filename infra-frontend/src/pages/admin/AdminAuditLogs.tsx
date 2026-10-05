import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { 
  History, Search, RefreshCw, ChevronLeft, ChevronRight, 
  ExternalLink, Filter, ShieldAlert, CheckCircle, Clock, AlertTriangle, XCircle
} from 'lucide-react';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { toast } from '../../store/toastStore';
import { errorMessage } from '../../lib/ticketUi';

interface AuditLogItem {
  id: number;
  ticket_id: number;
  user_id: number;
  action: string;
  remarks: string | null;
  created_at: string;
  ticket_title: string | null;
  ticket_department: string;
  ticket_status: string;
  actor_name: string;
  actor_email: string;
  actor_role: string;
  is_self_action?: number | boolean;
}

interface DeletedItem {
  id: number;
  ticket_id: number;
  deleted_by_name: string | null;
  deleted_at: string;
  reason: string;
  file_count: number;
  title: string | null;
  status: string | null;
  estimate: number | string | null;
  award_amount: number | string | null;
}

/** Tombstones of deleted tickets: who removed what, when and why. */
function DeletedTickets() {
  const [rows, setRows] = useState<DeletedItem[] | null>(null);
  useEffect(() => {
    api.get('/admin/deleted-tickets').then((r) => setRows(r.data.deleted ?? [])).catch(() => setRows([]));
  }, []);
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200/80 dark:border-slate-700 shadow-sm overflow-hidden">
      {rows === null ? (
        <div className="p-12 text-center text-slate-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="p-12 text-center text-slate-400">No ticket has been deleted.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-900/30 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                <th className="py-3 px-4">Ticket</th><th className="py-3 px-4">Title</th><th className="py-3 px-4">Deleted</th>
                <th className="py-3 px-4">By</th><th className="py-3 px-4">Reason</th><th className="py-3 px-4">Files</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="py-3 px-4 font-mono font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap">#TKT-{String(d.ticket_id).padStart(4, '0')}</td>
                  <td className="py-3 px-4 max-w-xs truncate">{d.title ?? '—'}{d.status ? <span className="block text-[10px] text-slate-400">{d.status.replace(/_/g, ' ')}</span> : null}</td>
                  <td className="py-3 px-4 whitespace-nowrap">{format(new Date(d.deleted_at), 'dd MMM yyyy, HH:mm')}</td>
                  <td className="py-3 px-4 whitespace-nowrap">{d.deleted_by_name ?? '—'}</td>
                  <td className="py-3 px-4 max-w-sm break-words">{d.reason}</td>
                  <td className="py-3 px-4">{d.file_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminAuditLogs() {
  const isDemo = useAuthStore((s) => !!s.user?.is_demo); // no deleted-tickets tab for the read-only demo Sysadmin
  const [tab, setTab] = useState<'log' | 'deleted'>('log');
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [ticketIdQuery, setTicketIdQuery] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [selfOnly, setSelfOnly] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 50;

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params: any = { page, limit };
      if (selfOnly) params.self_only = '1';
      if (ticketIdQuery.trim()) {
        params.ticket_id = ticketIdQuery.trim();
      }
      const response = await api.get('/admin/audit-logs', { params });
      if (response.data.success) {
        setLogs(response.data.logs || []);
      }
    } catch (err) {
      console.error('Failed to load audit logs:', err);
      toast.error(errorMessage(err, 'Could not load the activity log.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [page, ticketIdQuery, selfOnly]);

  const filteredLogs = logs.filter(log => {
    if (actionFilter !== 'ALL' && log.action !== actionFilter) return false;
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      const matchesActor = log.actor_name?.toLowerCase().includes(q) || log.actor_email?.toLowerCase().includes(q);
      const matchesRemarks = log.remarks?.toLowerCase().includes(q);
      const matchesTitle = log.ticket_title?.toLowerCase().includes(q);
      const matchesId = log.ticket_id?.toString().includes(q);
      return matchesActor || matchesRemarks || matchesTitle || matchesId;
    }
    return true;
  });

  const getActionBadge = (action: string) => {
    if (action.includes('APPROV')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
          <CheckCircle size={12} /> {action}
        </span>
      );
    }
    if (action.includes('REJECT') || action.includes('DENI')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
          <XCircle size={12} /> {action}
        </span>
      );
    }
    if (action.includes('RETURN')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
          <AlertTriangle size={12} /> {action}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
        <Clock size={12} /> {action}
      </span>
    );
  };

  const getRoleBadge = (role: string) => {
    const roleColors: Record<string, string> = {
      SYSADMIN: 'bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300 border-purple-200 dark:border-purple-800',
      DIRECTOR: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300 border-red-200 dark:border-red-800',
      DEAN: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200 dark:border-amber-800',
      SE: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
      AE: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300 border-blue-200 dark:border-blue-800',
      JE: 'bg-teal-100 text-teal-800 dark:bg-teal-950/50 dark:text-teal-300 border-teal-200 dark:border-teal-800',
      CLERICAL: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800',
      ACCOUNTANT: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
      APPLICANT: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700'
    };
    return (
      <span className={`px-2 py-0.5 text-[11px] font-bold rounded border ${roleColors[role] || roleColors.APPLICANT}`}>
        {role}
      </span>
    );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 w-full">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-gray-200/80 dark:border-slate-700 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-xl">
              <History size={24} />
            </span>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Audit Log</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                All workflow actions and overrides.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={() => fetchLogs()}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-sm font-semibold transition"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {!isDemo && (
      <div className="flex gap-1 p-1 bg-slate-200/60 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 w-fit">
        {([['log', 'Audit log'], ['deleted', 'Deleted tickets']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition ${tab === k ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-700/50'}`}>
            {label}
          </button>
        ))}
      </div>
      )}

      {tab === 'deleted' && !isDemo ? <DeletedTickets /> : (<>
      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-gray-200/80 dark:border-slate-700 shadow-sm space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* Quick Ticket ID filter */}
          <div className="md:col-span-3 relative">
            <input
              type="number"
              placeholder="Ticket number"
              value={ticketIdQuery}
              onChange={(e) => {
                setTicketIdQuery(e.target.value);
                setPage(1);
              }}
              className="w-full pl-3 pr-8 py-2 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 dark:text-white"
            />
            {ticketIdQuery && (
              <button
                onClick={() => setTicketIdQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                ✕
              </button>
            )}
          </div>

          {/* Action Filter */}
          <div className="md:col-span-3 relative">
            <Filter size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 dark:text-white"
            >
              <option value="ALL">All Actions</option>
              {['SUBMITTED', 'FORWARDED', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'REASSIGNED', 'OVERRIDE',
                'TENDER_PUBLISHED', 'TECH_EVALUATION', 'FIN_EVALUATION', 'TENDER_CANCELLED', 'WORK_AWARDED', 'RESOLVED', 'SENT_BACK', 'BILL_RECORDED'].map((a) => (
                <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          {/* Search Term */}
          <div className="md:col-span-4 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search name, e-mail or remarks"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 dark:text-white"
            />
          </div>

          <label className="md:col-span-2 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={selfOnly} onChange={(e) => { setSelfOnly(e.target.checked); setPage(1); }} className="h-4 w-4 rounded" />
            Self actions only
          </label>
        </div>
      </div>

      {/* Audit Stream Table */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200/80 dark:border-slate-700 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-20 text-center">
            <RefreshCw className="animate-spin text-indigo-500 mx-auto mb-3" size={32} />
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Loading…</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="py-20 text-center">
            <History size={40} className="text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-base font-semibold text-slate-700 dark:text-slate-300">No entries</p>
            <p className="text-sm text-slate-400">Nothing matches these filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 dark:bg-slate-900/60 border-b border-gray-200/80 dark:border-slate-700 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-4">Ticket</th>
                  <th className="py-3.5 px-4">Actor</th>
                  <th className="py-3.5 px-4">Action</th>
                  <th className="py-3.5 px-4 min-w-[280px]">Details</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700/60 text-sm">
                {filteredLogs.map((log) => {
                  const isOverride = log.remarks?.includes('[SYSADMIN OVERRIDE');
                  return (
                    <tr
                      key={log.id}
                      className={`hover:bg-slate-50/70 dark:hover:bg-slate-700/30 transition ${
                        isOverride ? 'bg-amber-50/40 dark:bg-amber-950/20' : ''
                      }`}
                    >
                      <td className="py-3.5 px-4 align-top">
                        <Link
                          to={`/admin/ticket/${log.ticket_id}`}
                          className="inline-flex items-center gap-1 font-mono font-bold text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          #TKT-{log.ticket_id.toString().padStart(4, '0')}
                          <ExternalLink size={12} />
                        </Link>
                        {log.ticket_title && (
                          <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[180px] mt-0.5">
                            {log.ticket_title}
                          </div>
                        )}
                        <span className="inline-block mt-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400 px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700/60 rounded">
                          {log.ticket_department}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 align-top">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {log.actor_name}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                          {log.actor_email}
                        </div>
                        <div className="mt-1">
                          {getRoleBadge(log.actor_role)}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 align-top whitespace-nowrap">
                        {getActionBadge(log.action)}
                        {log.is_self_action ? (
                          <span title="The actor raised this ticket" className="ml-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-violet-800 dark:bg-violet-900/30 dark:text-violet-300">Self</span>
                        ) : null}
                      </td>

                      <td className="py-3.5 px-4 align-top text-slate-700 dark:text-slate-300">
                        {isOverride && (
                          <div className="inline-flex items-center gap-1 mb-1 text-[10px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 rounded">
                            <ShieldAlert size={12} /> Override
                          </div>
                        )}
                        <p className="whitespace-pre-wrap text-xs md:text-sm font-sans leading-relaxed">
                          {log.remarks || <span className="text-slate-400 italic">No remarks</span>}
                        </p>
                      </td>

                      <td className="py-3.5 px-4 align-top whitespace-nowrap text-xs text-slate-500 dark:text-slate-400 font-mono">
                        <div>{format(new Date(log.created_at), 'dd MMM yyyy')}</div>
                        <div className="text-[11px] text-slate-400">{format(new Date(log.created_at), 'hh:mm:ss a')}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        <div className="p-4 border-t border-gray-100 dark:border-slate-700/60 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>{filteredLogs.length} entries · Page {page}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
              className="p-2 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 disabled:opacity-40"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={logs.length < limit || loading}
              className="p-2 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
      </>)}
    </div>
  );
}
