import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  Users, ClipboardList, IndianRupee,
  Activity, RefreshCw, BarChart3,
  HardHat, AlertTriangle, Scale, Loader2
} from 'lucide-react';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { toast } from '../../store/toastStore';
import { errorMessage, inr } from '../../lib/ticketUi';

interface AdminMetrics {
  totalTickets: number;
  totalUsers: number;
  totalSanctionedAmount: number;
  totalEstimatedAmount: number;
  pendingInspection: number;
  awaitingApproval: number;
  inTendering: number;
  closed: number;
  selfActions30d?: number;
  byDepartment: { department: string; count: number }[];
  byStatus: { status: string; count: number }[];
  activeJes: {
    id: number;
    full_name: string;
    email: string;
    department: string;
    active_tickets_count: number;
  }[];
}

interface DeskHealth { count: number; placeholder: boolean; ok: boolean; message: string | null }

export default function AdminDashboard() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [deskHealth, setDeskHealth] = useState<Record<string, DeskHealth> | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMetrics = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/metrics');
      if (res.data.success) {
        setMetrics(res.data.metrics);
        setDeskHealth(res.data.desk_health ?? null);
      }
    } catch (err) {
      console.error('Failed to load admin metrics:', err);
      toast.error(errorMessage(err, 'Could not load the dashboard.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, []);

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6 animate-in fade-in duration-200 pb-16">
      
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white">Administration</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Deanery of Infrastructure</p>
        </div>
        <button
          onClick={fetchMetrics}
          disabled={loading}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700/60 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Dean / Director must each have exactly one real holder. */}
      {deskHealth && Object.values(deskHealth).some((h) => !h.ok) && (
        <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="mb-1 flex items-center gap-2 font-bold"><AlertTriangle size={16} /> Check these desks</p>
          <ul className="list-disc space-y-1 pl-5">
            {Object.values(deskHealth).filter((h) => !h.ok && h.message).map((h) => <li key={h.message}>{h.message}</li>)}
          </ul>
          <p className="mt-2 text-xs">Approvals still go to the placeholder account until the e-mail is changed. If the real person already signed in, deactivate their new account first, then set the e-mail on the placeholder.</p>
        </div>
      )}

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Tickets</span>
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <ClipboardList size={20} />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900 dark:text-white">
              {metrics?.totalTickets ?? '—'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            {metrics?.closed ?? 0} closed
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Approved Amount</span>
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <IndianRupee size={20} />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              ₹{(metrics?.totalSanctionedAmount || 0).toLocaleString('en-IN')}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Approved works in progress
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Tenders and Works</span>
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Activity size={20} />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900 dark:text-white">
              {metrics?.inTendering ?? '—'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Tender published or awarded
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Users</span>
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <Users size={20} />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900 dark:text-white">
              {metrics?.totalUsers ?? '—'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
            {metrics?.selfActions30d ?? 0} self actions in 30 days
          </p>
        </div>
      </div>

      {/* Tickets by status and JE workloads */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Cols: Pipeline Distribution */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <BarChart3 size={18} className="text-blue-600" /> Tickets by Status
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">Open tickets by stage.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider block">With JE</span>
                <span className="text-2xl font-black text-amber-800 dark:text-amber-200 mt-1 block font-mono">
                  {metrics?.pendingInspection ?? 0}
                </span>
                <span className="text-[10px] text-amber-600/80 dark:text-amber-400/80">Inspection pending</span>
              </div>

              <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20">
                <span className="text-[10px] font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider block">Awaiting Approval</span>
                <span className="text-2xl font-black text-blue-800 dark:text-blue-200 mt-1 block font-mono">
                  {metrics?.awaitingApproval ?? 0}
                </span>
                <span className="text-[10px] text-blue-600/80 dark:text-blue-400/80">AE / SE / Dean / Director</span>
              </div>

              <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                <span className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider block">Tenders and Works</span>
                <span className="text-2xl font-black text-indigo-800 dark:text-indigo-200 mt-1 block font-mono">
                  {metrics?.inTendering ?? 0}
                </span>
                <span className="text-[10px] text-indigo-600/80 dark:text-indigo-400/80">Tender or work in progress</span>
              </div>

              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider block">Closed</span>
                <span className="text-2xl font-black text-emerald-800 dark:text-emerald-200 mt-1 block font-mono">
                  {metrics?.closed ?? 0}
                </span>
                <span className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80">Paid and closed</span>
              </div>
            </div>

            {/* Department Breakdown */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-700/80 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Tickets by Department</h3>
              <div className="grid grid-cols-3 gap-3">
                {['Civil', 'Electrical', 'Horticulture'].map((dept) => {
                  const item = metrics?.byDepartment.find(d => d.department.toLowerCase() === dept.toLowerCase());
                  const count = item ? item.count : 0;
                  return (
                    <div key={dept} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-700/60">
                      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">{dept}</span>
                      <span className="text-lg font-bold text-slate-900 dark:text-white mt-1 block font-mono">{count} tickets</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Right Col: Junior Engineers Active Workload & System Status */}
        <div className="space-y-6">
          {/* Active JE Workload */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <HardHat size={16} className="text-amber-500" /> JE Workload
              </h2>
              <span className="text-[11px] font-semibold text-slate-400">{metrics?.activeJes?.length || 0} JEs</span>
            </div>

            <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
              {metrics?.activeJes && metrics.activeJes.length > 0 ? (
                metrics.activeJes.map((je) => (
                  <div key={je.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/70 dark:border-slate-700/70 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-slate-900 dark:text-white">{je.full_name}</p>
                      <p className="text-[11px] text-slate-500">{je.department}</p>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                      {je.active_tickets_count} Active
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-400 text-center py-4">No active JEs.</p>
              )}
            </div>
          </div>

          <ApprovalLimits />

        </div>

      </div>

    </div>
  );
}

interface LimitRow { amount: number | null; updated_at: string | null; updated_by: string | null }
type Limits = { SE_APPROVE: LimitRow; DEAN_APPROVE: LimitRow };

/** The SE and Dean approval limits. The Director has none. Edit is hidden for the read-only demo Sysadmin. */
function ApprovalLimits() {
  const isDemo = useAuthStore((s) => !!s.user?.is_demo);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [editing, setEditing] = useState(false);
  const [se, setSe] = useState('');
  const [dean, setDean] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/admin/limits')
      .then((res) => setLimits(res.data.limits))
      .catch((err) => toast.error(errorMessage(err, 'Could not load the approval limits.')));
  }, []);

  const startEdit = () => {
    setSe(String(limits?.SE_APPROVE.amount ?? ''));
    setDean(String(limits?.DEAN_APPROVE.amount ?? ''));
    setEditing(true);
  };

  const invalid = !(Number(se) > 0) || !(Number(dean) > 0) || Number(se) >= Number(dean);

  const save = async () => {
    if (invalid || busy) return;
    if (!window.confirm('Change approval limits? This applies to open tickets now.')) return;
    setBusy(true);
    try {
      const res = await api.put('/admin/limits', { SE_APPROVE: Number(se), DEAN_APPROVE: Number(dean) });
      setLimits(res.data.limits);
      setEditing(false);
      toast.success(res.data.message || 'Limits saved.');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save the limits.'));
    } finally {
      setBusy(false);
    }
  };

  const changed = limits
    ? [limits.SE_APPROVE, limits.DEAN_APPROVE].filter((r) => r.updated_by && r.updated_at)
      .sort((x, y) => String(y.updated_at).localeCompare(String(x.updated_at)))[0]
    : undefined;
  const inputCls = 'w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-mono text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white';

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Scale size={16} className="text-blue-500" /> Approval limits
        </h2>
        {!editing && !isDemo && limits && (
          <button onClick={startEdit} className="text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400">Edit</button>
        )}
      </div>

      {!limits ? (
        <div className="flex justify-center py-4 text-blue-600"><Loader2 className="animate-spin" size={20} /></div>
      ) : editing ? (
        <div className="space-y-3">
          <div>
            <label htmlFor="limit-se" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">SE (₹)</label>
            <input id="limit-se" type="number" min="0" step="0.01" className={inputCls} value={se} onChange={(e) => setSe(e.target.value)} />
          </div>
          <div>
            <label htmlFor="limit-dean" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Dean (₹)</label>
            <input id="limit-dean" type="number" min="0" step="0.01" className={inputCls} value={dean} onChange={(e) => setDean(e.target.value)} />
          </div>
          {Number(se) > 0 && Number(dean) > 0 && Number(se) >= Number(dean) && (
            <p className="text-xs text-rose-600">The SE limit must be lower than the Dean limit.</p>
          )}
          <div className="flex gap-2">
            <button onClick={save} disabled={invalid || busy}
              className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
              {busy && <Loader2 size={13} className="animate-spin" />} Save
            </button>
            <button onClick={() => setEditing(false)} className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between border-b border-slate-100 py-1.5 dark:border-slate-700/60">
            <span className="text-slate-600 dark:text-slate-400">SE</span>
            <span className="font-mono font-bold text-slate-900 dark:text-white">{inr(limits.SE_APPROVE.amount)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-slate-100 py-1.5 dark:border-slate-700/60">
            <span className="text-slate-600 dark:text-slate-400">Dean</span>
            <span className="font-mono font-bold text-slate-900 dark:text-white">{inr(limits.DEAN_APPROVE.amount)}</span>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-slate-600 dark:text-slate-400">Director</span>
            <span className="text-slate-500">No limit</span>
          </div>
          {changed?.updated_by && (
            <p className="pt-1 text-[11px] text-slate-400">Changed {format(new Date(changed.updated_at!), 'd MMM yyyy')} by {changed.updated_by}</p>
          )}
        </div>
      )}
    </div>
  );
}
