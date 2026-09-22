import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  CheckCircle2, Clock, XCircle,
  ShieldCheck, IndianRupee, Search, RefreshCw,
  Building2, Eye
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { api } from '../../services/api';

interface AuthorityTicket {
  id: number;
  title: string | null;
  description: string;
  department: string;
  type: string;
  status: string;
  created_at: string;
  applicant_name: string;
  applicant_email: string;
  estimated_amount: number | string | null;
  nature_of_work: string | null;
  nit_number?: string | null;
  awarded_agency?: string | null;
}

const BUDGET_CEILINGS: Record<string, number> = {
  AE: 25000,
  SE: 50000,
  DEAN: 500000,
  DIRECTOR: Infinity,
};

const NEXT_DESK: Record<string, string> = {
  AE: 'Superintending Engineer (SE)',
  SE: 'Dean of Infrastructure',
  DEAN: 'Director of IIT Mandi',
  DIRECTOR: 'Sanctioned for Tendering',
};

export default function AuthorityDashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const role = user?.role || 'AE';
  const ceiling = BUDGET_CEILINGS[role] || 0;
  const roleDepartment = user?.department || 'Civil';

  const [activeTab, setActiveTab] = useState<'pending' | 'all' | 'returned' | 'high_value'>('pending');
  const [tickets, setTickets] = useState<AuthorityTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Quick Action Modal
  const [selectedTicket, setSelectedTicket] = useState<AuthorityTicket | null>(null);
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [actionType, setActionType] = useState<'APPROVE' | 'RETURN' | 'DENY'>('APPROVE');
  const [remarks, setRemarks] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const fetchQueue = async () => {
    setLoading(true);
    try {
      const res = await api.get('/tickets/queue', {
        params: {
          tab: activeTab,
          search: searchQuery.trim() || undefined,
        },
      });
      if (res.data.success) {
        setTickets(res.data.tickets || []);
      }
    } catch (err) {
      console.error('Failed to load authority queue:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
  }, [activeTab]);

  const handleOpenAction = (ticket: AuthorityTicket, action: 'APPROVE' | 'RETURN' | 'DENY') => {
    setSelectedTicket(ticket);
    setActionType(action);
    setRemarks('');
    setActionModalOpen(true);
  };

  const handleExecuteAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket) return;

    if ((actionType === 'RETURN' || actionType === 'DENY') && !remarks.trim()) {
      alert('Remarks are strictly required when returning or denying a ticket.');
      return;
    }

    setIsProcessing(true);
    try {
      const res = await api.post(`/tickets/${selectedTicket.id}/review`, {
        action: actionType,
        remarks: remarks.trim() || undefined,
      });

      if (res.data.success) {
        alert(`Ticket successfully updated to ${res.data.status.replace(/_/g, ' ')}.`);
        setActionModalOpen(false);
        fetchQueue();
      }
    } catch (err: any) {
      console.error('Review action failed:', err);
      alert(err.response?.data?.message || 'Failed to process authority review.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Check if estimate exceeds this desk's financial threshold
  const getEscalationNotice = (ticket: AuthorityTicket) => {
    const est = parseFloat(String(ticket.estimated_amount || 0));
    if (est <= ceiling) {
      return {
        willSanction: true,
        text: 'Within your sanction limit. Approving will immediately sanction work for GeM / CPP tendering.',
      };
    }
    return {
      willSanction: false,
      text: `Exceeds your limit (₹${ceiling.toLocaleString('en-IN')}). Approving will endorse and escalate to ${NEXT_DESK[role]}.`,
    };
  };

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6 animate-in fade-in duration-300 pb-16">
      
      {/* Authority Header Card */}
      <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md p-6 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-700/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              <ShieldCheck size={22} />
            </span>
            <div>
              <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white">
                {role === 'AE' ? 'Assistant Engineer (AE) Review Desk' :
                 role === 'SE' ? 'Superintending Engineer (SE) Sanction Desk' :
                 role === 'DEAN' ? 'Deanery of Infrastructure Sanction Portal' :
                 'Director’s Supreme Sanction Portal'}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {role === 'DEAN' || role === 'DIRECTOR'
                  ? 'Campus-Wide Infrastructure Governance · All Engineering Departments'
                  : `${roleDepartment} Engineering Department · Technical & Budgetary Sanctions`}
              </p>
            </div>
          </div>
        </div>

        {/* Financial Ceiling Badge */}
        <div className="flex items-center gap-3 self-start md:self-auto">
          <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 text-right">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Sanction Ceiling</span>
            <span className="font-mono font-black text-sm text-slate-900 dark:text-white flex items-center justify-end gap-1">
              <IndianRupee size={13} className="text-emerald-600" />
              {ceiling === Infinity ? 'Unlimited Authority' : `₹${ceiling.toLocaleString('en-IN')}`}
            </span>
          </div>

          <button
            onClick={fetchQueue}
            className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition shadow-sm"
            title="Refresh Queue"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 p-1.5 bg-slate-200/60 dark:bg-slate-800/60 backdrop-blur-md rounded-2xl border border-slate-200/80 dark:border-slate-700/80">
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all flex items-center gap-2 ${
            activeTab === 'pending'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <Clock size={16} /> Pending My Action
        </button>

        <button
          onClick={() => setActiveTab('all')}
          className={`px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all flex items-center gap-2 ${
            activeTab === 'all'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <Building2 size={16} /> {role === 'DEAN' || role === 'DIRECTOR' ? 'All Campus Works' : 'Department Works'}
        </button>

        <button
          onClick={() => setActiveTab('returned')}
          className={`px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all flex items-center gap-2 ${
            activeTab === 'returned'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <XCircle size={16} /> Returned Works
        </button>

        {(role === 'DEAN' || role === 'DIRECTOR') && (
          <button
            onClick={() => setActiveTab('high_value')}
            className={`px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all flex items-center gap-2 ${
              activeTab === 'high_value'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-700/50'
            }`}
          >
            <IndianRupee size={16} /> High-Value CapEx (&gt; ₹2L)
          </button>
        )}
      </div>

      {/* Filter Bar */}
      <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchQueue()}
            placeholder="Search by ticket ID, work title, applicant, or description..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs md:text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={fetchQueue}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition shadow-sm"
        >
          Search
        </button>
      </div>

      {/* Queue Table */}
      {loading ? (
        <div className="p-12 text-center text-slate-400">Loading authority queue...</div>
      ) : tickets.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-slate-400">
          No tickets found in this queue.
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/70 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 text-[11px] uppercase font-bold text-slate-400">
                  <th className="py-3 px-4">Ticket</th>
                  <th className="py-3 px-4">Title & Scope</th>
                  <th className="py-3 px-4">Applicant</th>
                  <th className="py-3 px-4">Department</th>
                  <th className="py-3 px-4">Estimated Sanction</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Review Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {tickets.map((t) => {
                  const estNotice = getEscalationNotice(t);
                  const isPendingDesk = 
                    (role === 'AE' && t.status === 'PENDING_AE_APPROVAL') ||
                    (role === 'SE' && t.status === 'PENDING_SE_APPROVAL') ||
                    (role === 'DEAN' && t.status === 'PENDING_DEAN_APPROVAL') ||
                    (role === 'DIRECTOR' && t.status === 'PENDING_DIRECTOR_APPROVAL');

                  return (
                    <tr key={t.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-700/30 transition">
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="font-mono font-bold text-blue-600 dark:text-blue-400 block">
                          #TKT-{t.id.toString().padStart(4, '0')}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {format(new Date(t.created_at), 'MMM dd, yyyy')}
                        </span>
                      </td>

                      <td className="py-3 px-4 max-w-xs">
                        <p className="font-bold text-slate-900 dark:text-white truncate">
                          {t.title || t.description}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">
                          {t.nature_of_work || t.description}
                        </p>
                        {isPendingDesk && (
                          <span className={`inline-block mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded ${
                            estNotice.willSanction
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                              : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300'
                          }`}>
                            {estNotice.willSanction ? '✓ Can Sanction' : '↑ Will Escalate'}
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        <p className="font-semibold text-slate-800 dark:text-slate-200">{t.applicant_name}</p>
                        <p className="text-[10px] text-slate-400">{t.applicant_email}</p>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 font-semibold text-[10px] text-slate-700 dark:text-slate-300">
                          {t.department}
                        </span>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap font-mono">
                        {t.estimated_amount ? (
                          <span className="font-bold text-slate-900 dark:text-white flex items-center gap-0.5">
                            <IndianRupee size={12} />
                            {parseFloat(String(t.estimated_amount)).toLocaleString('en-IN')}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">No Estimate</span>
                        )}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                          t.status.includes('PENDING')
                            ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20'
                            : t.status === 'APPROVED_FOR_TENDERING'
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                        }`}>
                          {t.status.replace(/_/g, ' ')}
                        </span>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap text-right space-x-1.5">
                        <button
                          onClick={() => navigate(`/ticket/${t.id}`)}
                          className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition"
                          title="Full Details"
                        >
                          <Eye size={14} />
                        </button>

                        {isPendingDesk && (
                          <>
                            <button
                              onClick={() => handleOpenAction(t, 'APPROVE')}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition shadow-sm inline-flex items-center gap-1"
                            >
                              <CheckCircle2 size={12} /> Approve
                            </button>

                            <button
                              onClick={() => handleOpenAction(t, 'RETURN')}
                              className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-[11px] transition shadow-sm inline-flex items-center gap-1"
                            >
                              Return
                            </button>

                            {role === 'DIRECTOR' && (
                              <button
                                onClick={() => handleOpenAction(t, 'DENY')}
                                className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] transition shadow-sm inline-flex items-center gap-1"
                              >
                                Reject
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* QUICK ACTION MODAL */}
      {actionModalOpen && selectedTicket && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 dark:border-slate-700 space-y-4 animate-in fade-in duration-150 text-xs">
            <div className="pb-3 border-b border-slate-100 dark:border-slate-700">
              <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                #TKT-{selectedTicket.id.toString().padStart(4, '0')}
              </span>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                {actionType === 'APPROVE' ? 'Endorse & Approve Sanction' :
                 actionType === 'RETURN' ? 'Return Ticket for Revision' :
                 'Deny / Reject Proposal'}
              </h3>
            </div>

            {actionType === 'APPROVE' && (
              <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-slate-700 dark:text-slate-300 space-y-1">
                <p className="font-semibold text-blue-900 dark:text-blue-300">Decision Outcome Preview:</p>
                <p>{getEscalationNotice(selectedTicket).text}</p>
              </div>
            )}

            <form onSubmit={handleExecuteAction} className="space-y-3">
              <div>
                <label className="font-bold text-slate-600 dark:text-slate-300 block mb-1">
                  Authority Remarks {actionType !== 'APPROVE' && <span className="text-rose-500">*</span>}
                </label>
                <textarea
                  rows={3}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder={
                    actionType === 'APPROVE'
                      ? 'Enter sanction approval endorsement notes (optional)...'
                      : 'Specify required modifications or technical clarifications (mandatory)...'
                  }
                  required={actionType !== 'APPROVE'}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setActionModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isProcessing}
                  className={`px-4 py-2 rounded-xl text-white font-bold transition disabled:opacity-50 ${
                    actionType === 'APPROVE' ? 'bg-emerald-600 hover:bg-emerald-700' :
                    actionType === 'RETURN' ? 'bg-amber-600 hover:bg-amber-700' :
                    'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {isProcessing ? 'Processing...' : `Confirm ${actionType}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
