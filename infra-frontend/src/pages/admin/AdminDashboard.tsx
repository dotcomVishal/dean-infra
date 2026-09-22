import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  ShieldAlert, Users, ClipboardList, IndianRupee, 
  Activity, ArrowUpRight, CheckCircle2, 
  RefreshCw, BarChart3, History,
  HardHat, Server
} from 'lucide-react';
import { api } from '../../services/api';

interface AdminMetrics {
  totalTickets: number;
  totalUsers: number;
  totalSanctionedAmount: number;
  totalEstimatedAmount: number;
  pendingInspection: number;
  awaitingApproval: number;
  inTendering: number;
  closed: number;
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

export default function AdminDashboard() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMetrics = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/metrics');
      if (res.data.success) {
        setMetrics(res.data.metrics);
      }
    } catch (err) {
      console.error('Failed to load admin metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, []);

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6 animate-in fade-in duration-200 pb-16">
      
      {/* Top Banner */}
      <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md p-6 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-700/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
              <ShieldAlert size={22} />
            </span>
            <div>
              <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white">
                System Administration Overview
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                IIT Mandi Deanery of Infrastructure · Master Health & Operations Dashboard
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700/60 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

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
            <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">All Time</span>
          </div>
          <p className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            {metrics?.closed ?? 0} tickets resolved and closed
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Sanctioned Outlay</span>
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
            Approved Capex under execution
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Tenders & Work</span>
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Activity size={20} />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900 dark:text-white">
              {metrics?.inTendering ?? '—'}
            </span>
            <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">In Progress</span>
          </div>
          <p className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Published or awarded contracts
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Registered Users</span>
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <Users size={20} />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-900 dark:text-white">
              {metrics?.totalUsers ?? '—'}
            </span>
            <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">Campus Accounts</span>
          </div>
          <p className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
            Across 9 hierarchy roles
          </p>
        </div>
      </div>

      {/* Quick Access Modules Navigation */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          to="/admin/tickets"
          className="group p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm hover:border-blue-500 dark:hover:border-blue-500 transition-all flex items-center justify-between"
        >
          <div className="flex items-center gap-3.5">
            <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 group-hover:scale-105 transition-transform">
              <ClipboardList size={22} />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">Master Tickets Directory</h3>
              <p className="text-xs text-slate-500 mt-0.5">Search, filter, and override any campus ticket</p>
            </div>
          </div>
          <ArrowUpRight size={18} className="text-slate-400 group-hover:text-blue-600 transition" />
        </Link>

        <Link
          to="/admin/users"
          className="group p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm hover:border-emerald-500 dark:hover:border-emerald-500 transition-all flex items-center justify-between"
        >
          <div className="flex items-center gap-3.5">
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 group-hover:scale-105 transition-transform">
              <Users size={22} />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">User Account Management</h3>
              <p className="text-xs text-slate-500 mt-0.5">Manage roles, engineering wings, and access</p>
            </div>
          </div>
          <ArrowUpRight size={18} className="text-slate-400 group-hover:text-emerald-600 transition" />
        </Link>

        <Link
          to="/admin/audit"
          className="group p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm hover:border-purple-500 dark:hover:border-purple-500 transition-all flex items-center justify-between"
        >
          <div className="flex items-center gap-3.5">
            <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 group-hover:scale-105 transition-transform">
              <History size={22} />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">Global Audit Trail</h3>
              <p className="text-xs text-slate-500 mt-0.5">Unredacted activity log and timeline stream</p>
            </div>
          </div>
          <ArrowUpRight size={18} className="text-slate-400 group-hover:text-purple-600 transition" />
        </Link>
      </div>

      {/* Main Content Grid: Workflow Pipeline & JE Workloads */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Cols: Pipeline Distribution */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <BarChart3 size={18} className="text-blue-600" /> Workflow Pipeline Distribution
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">Current operational stage breakdown across campus</p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider block">Inspection Pending</span>
                <span className="text-2xl font-black text-amber-800 dark:text-amber-200 mt-1 block font-mono">
                  {metrics?.pendingInspection ?? 0}
                </span>
                <span className="text-[10px] text-amber-600/80 dark:text-amber-400/80">With Junior Engineers</span>
              </div>

              <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20">
                <span className="text-[10px] font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider block">Awaiting Approval</span>
                <span className="text-2xl font-black text-blue-800 dark:text-blue-200 mt-1 block font-mono">
                  {metrics?.awaitingApproval ?? 0}
                </span>
                <span className="text-[10px] text-blue-600/80 dark:text-blue-400/80">AE / SE / Dean / Director</span>
              </div>

              <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                <span className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider block">In Tendering / Work</span>
                <span className="text-2xl font-black text-indigo-800 dark:text-indigo-200 mt-1 block font-mono">
                  {metrics?.inTendering ?? 0}
                </span>
                <span className="text-[10px] text-indigo-600/80 dark:text-indigo-400/80">Clerical & GeM execution</span>
              </div>

              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider block">Closed & Settled</span>
                <span className="text-2xl font-black text-emerald-800 dark:text-emerald-200 mt-1 block font-mono">
                  {metrics?.closed ?? 0}
                </span>
                <span className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80">Disbursed by Accounts</span>
              </div>
            </div>

            {/* Department Breakdown */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-700/80 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Distribution by Engineering Wing</h3>
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
                <HardHat size={16} className="text-amber-500" /> JE Active Workloads
              </h2>
              <span className="text-[11px] font-semibold text-slate-400">{metrics?.activeJes?.length || 0} Engineers</span>
            </div>

            <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
              {metrics?.activeJes && metrics.activeJes.length > 0 ? (
                metrics.activeJes.map((je) => (
                  <div key={je.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/70 dark:border-slate-700/70 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-slate-900 dark:text-white">{je.full_name}</p>
                      <p className="text-[11px] text-slate-500">{je.department} Wing</p>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                      {je.active_tickets_count} Active
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-400 text-center py-4">No active Junior Engineers found.</p>
              )}
            </div>
          </div>

          {/* System Health Card */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 p-5 shadow-sm space-y-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Server size={16} className="text-emerald-500" /> Service Status
            </h2>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-700/60">
                <span className="text-slate-600 dark:text-slate-400">MySQL Database Pool</span>
                <span className="flex items-center gap-1.5 text-emerald-600 font-bold">
                  <CheckCircle2 size={13} /> Connected (Healthy)
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-700/60">
                <span className="text-slate-600 dark:text-slate-400">Authentication Service</span>
                <span className="flex items-center gap-1.5 text-emerald-600 font-bold">
                  <CheckCircle2 size={13} /> Google OAuth SSO
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-700/60">
                <span className="text-slate-600 dark:text-slate-400">Nginx Reverse Proxy</span>
                <span className="flex items-center gap-1.5 text-emerald-600 font-bold">
                  <CheckCircle2 size={13} /> Active (:8085)
                </span>
              </div>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
