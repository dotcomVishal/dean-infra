import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  FileSpreadsheet, Search, RefreshCw, Eye,
  Clock, IndianRupee, Send, Award, X,
  FileText
} from 'lucide-react';
import { api } from '../../services/api';

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

  // Modals
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [awardModalOpen, setAwardModalOpen] = useState(false);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<TenderTicket | null>(null);
  const [ticketDetails, setTicketDetails] = useState<any | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Form states
  const [nitData, setNitData] = useState({
    nit_number: '',
    portal_type: 'GeM',
    published_date: format(new Date(), 'yyyy-MM-dd'),
    bid_opening_date: '',
    remarks: ''
  });
  const [awardData, setAwardData] = useState({
    awarded_agency: '',
    work_order_value: '',
    remarks: ''
  });
  const [submitting, setSubmitting] = useState(false);

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
      console.error('Failed to load clerical queue:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, [activeTab]);

  // Open Publish Tender Modal
  const handleOpenPublish = (ticket: TenderTicket) => {
    setSelectedTicket(ticket);
    setNitData({
      nit_number: `IITM/INFRA/${new Date().getFullYear()}/NIT-${ticket.id.toString().padStart(4, '0')}`,
      portal_type: 'GeM',
      published_date: format(new Date(), 'yyyy-MM-dd'),
      bid_opening_date: '',
      remarks: ''
    });
    setPublishModalOpen(true);
  };

  // Submit Tender Publication
  const handlePublishSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !nitData.nit_number) return;

    setSubmitting(true);
    try {
      const res = await api.post(`/tickets/${selectedTicket.id}/tenders`, nitData);
      if (res.data.success) {
        alert(`Tender notice published on ${nitData.portal_type}. Status updated to TENDER_PUBLISHED.`);
        setPublishModalOpen(false);
        fetchTickets();
      }
    } catch (err: any) {
      console.error('Publish tender error:', err);
      alert(err.response?.data?.message || 'Failed to publish tender.');
    } finally {
      setSubmitting(false);
    }
  };

  // Open Award Modal
  const handleOpenAward = (ticket: TenderTicket) => {
    setSelectedTicket(ticket);
    setAwardData({
      awarded_agency: '',
      work_order_value: ticket.estimated_amount ? String(ticket.estimated_amount) : '',
      remarks: ''
    });
    setAwardModalOpen(true);
  };

  // Submit Award
  const handleAwardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !awardData.awarded_agency) return;

    setSubmitting(true);
    try {
      const res = await api.post(`/tickets/${selectedTicket.id}/tenders/award`, awardData);
      if (res.data.success) {
        alert('Work contract awarded successfully. Ticket moved to WORK_IN_PROGRESS.');
        setAwardModalOpen(false);
        fetchTickets();
      }
    } catch (err: any) {
      console.error('Award tender error:', err);
      alert(err.response?.data?.message || 'Failed to award contract.');
    } finally {
      setSubmitting(false);
    }
  };

  // Open Details Modal
  const handleOpenDetails = async (ticket: TenderTicket) => {
    setSelectedTicket(ticket);
    setDetailsModalOpen(true);
    setLoadingDetails(true);
    try {
      const res = await api.get(`/tickets/${ticket.id}/details`);
      if (res.data.success) {
        setTicketDetails(res.data.ticket);
      }
    } catch (err) {
      console.error('Failed to load details:', err);
    } finally {
      setLoadingDetails(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6 animate-in fade-in duration-300 pb-16">
      
      {/* Top Header Card */}
      <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md p-6 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-700/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20">
              <FileSpreadsheet size={22} />
            </span>
            <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white">
              Clerical Tender & Contracts Cell
            </h1>
          </div>
          <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-1">
            NIT Notice Publication · GeM & CPP Portal Procurement · Contract Execution Tracking
          </p>
        </div>

        <button
          onClick={fetchTickets}
          className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition self-start md:self-auto shadow-sm"
        >
          <RefreshCw size={14} /> Refresh Desk
        </button>
      </div>

      {/* Tab Pills */}
      <div className="flex flex-wrap gap-1 p-1.5 bg-slate-200/60 dark:bg-slate-800/60 backdrop-blur-md rounded-2xl border border-slate-200/80 dark:border-slate-700/80">
        <button
          onClick={() => setActiveTab('awaiting_nit')}
          className={`px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all flex items-center gap-2 ${
            activeTab === 'awaiting_nit'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <Clock size={16} /> Awaiting Tender Notice (Sanctioned)
        </button>

        <button
          onClick={() => setActiveTab('published')}
          className={`px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all flex items-center gap-2 ${
            activeTab === 'published'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <Send size={16} /> Published Tenders (Under Bidding)
        </button>

        <button
          onClick={() => setActiveTab('in_progress')}
          className={`px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all flex items-center gap-2 ${
            activeTab === 'in_progress'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <Award size={16} /> Awarded Works (In Progress)
        </button>

        <button
          onClick={() => setActiveTab('all')}
          className={`px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all flex items-center gap-2 ${
            activeTab === 'all'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <FileText size={16} /> All Contracts
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
            placeholder="Search by ticket ID, title, agency, or NIT number..."
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
        <div className="p-12 text-center text-slate-400">Loading clerical queue...</div>
      ) : tickets.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-slate-400">
          No tickets currently in this stage.
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/70 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 text-[11px] uppercase font-bold text-slate-400">
                  <th className="py-3 px-4">Ticket</th>
                  <th className="py-3 px-4">Title & Scope</th>
                  <th className="py-3 px-4">Department</th>
                  <th className="py-3 px-4">Sanctioned Cost</th>
                  <th className="py-3 px-4">Tender / Award Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {tickets.map((t) => (
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
                        {t.title || 'Untitled Work'}
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

                    <td className="py-3 px-4 whitespace-nowrap font-mono">
                      {t.estimated_amount ? (
                        <span className="font-bold text-slate-900 dark:text-white flex items-center gap-0.5">
                          <IndianRupee size={13} />
                          {parseFloat(String(t.estimated_amount)).toLocaleString('en-IN')}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      {t.awarded_agency ? (
                        <div>
                          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 block">
                            Awarded: {t.awarded_agency}
                          </span>
                          {t.work_order_value && (
                            <span className="font-mono text-[10px] text-slate-500">
                              Val: ₹{parseFloat(String(t.work_order_value)).toLocaleString('en-IN')}
                            </span>
                          )}
                        </div>
                      ) : t.status === 'TENDER_PUBLISHED' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border border-cyan-500/20">
                          Live on {t.portal_type || 'GeM'}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                          Awaiting NIT Release
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap text-right space-x-1.5">
                      <button
                        onClick={() => handleOpenDetails(t)}
                        className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition"
                        title="View Details"
                      >
                        <Eye size={14} />
                      </button>

                      {t.status === 'APPROVED_FOR_TENDERING' && (
                        <button
                          onClick={() => handleOpenPublish(t)}
                          className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px] transition shadow-sm inline-flex items-center gap-1"
                        >
                          <Send size={12} /> Publish NIT
                        </button>
                      )}

                      {t.status === 'TENDER_PUBLISHED' && (
                        <button
                          onClick={() => handleOpenAward(t)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition shadow-sm inline-flex items-center gap-1"
                        >
                          <Award size={12} /> Award Contract
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL 1: PUBLISH TENDER NOTIFICATION */}
      {publishModalOpen && selectedTicket && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 dark:border-slate-700 space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Send className="text-blue-600" size={18} /> Publish Tender Notice (NIT)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  #TKT-{selectedTicket.id.toString().padStart(4, '0')} · {selectedTicket.title || selectedTicket.description}
                </p>
              </div>
              <button onClick={() => setPublishModalOpen(false)} className="p-1 rounded-lg text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handlePublishSubmit} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-600 dark:text-slate-300 block mb-1">NIT / Bid Reference Number</label>
                <input
                  type="text"
                  value={nitData.nit_number}
                  onChange={(e) => setNitData({ ...nitData, nit_number: e.target.value })}
                  required
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-600 dark:text-slate-300 block mb-1">Portal Platform</label>
                  <select
                    value={nitData.portal_type}
                    onChange={(e) => setNitData({ ...nitData, portal_type: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none"
                  >
                    <option value="GeM">GeM Portal</option>
                    <option value="CPP Portal">CPP Portal</option>
                    <option value="State Tender">State e-Procurement</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-600 dark:text-slate-300 block mb-1">Publish Date</label>
                  <input
                    type="date"
                    value={nitData.published_date}
                    onChange={(e) => setNitData({ ...nitData, published_date: e.target.value })}
                    required
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-600 dark:text-slate-300 block mb-1">Bid Opening Date (Optional)</label>
                <input
                  type="date"
                  value={nitData.bid_opening_date}
                  onChange={(e) => setNitData({ ...nitData, bid_opening_date: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="font-bold text-slate-600 dark:text-slate-300 block mb-1">Tender Remarks</label>
                <textarea
                  rows={2}
                  value={nitData.remarks}
                  onChange={(e) => setNitData({ ...nitData, remarks: e.target.value })}
                  placeholder="e.g. GeM custom bid generated; technical qualification criteria attached..."
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setPublishModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition disabled:opacity-50"
                >
                  {submitting ? 'Publishing...' : 'Confirm NIT Publication'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: AWARD CONTRACT MODAL */}
      {awardModalOpen && selectedTicket && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 dark:border-slate-700 space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Award className="text-emerald-600" size={18} /> Record Work Order Award
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  #TKT-{selectedTicket.id.toString().padStart(4, '0')} · {selectedTicket.title || selectedTicket.description}
                </p>
              </div>
              <button onClick={() => setAwardModalOpen(false)} className="p-1 rounded-lg text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAwardSubmit} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-600 dark:text-slate-300 block mb-1">Awarded Agency / Contractor Name</label>
                <input
                  type="text"
                  value={awardData.awarded_agency}
                  onChange={(e) => setAwardData({ ...awardData, awarded_agency: e.target.value })}
                  placeholder="e.g. M/s Himalayan Engineering Works"
                  required
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-600 dark:text-slate-300 block mb-1">Contract / Work Order Value (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={awardData.work_order_value}
                  onChange={(e) => setAwardData({ ...awardData, work_order_value: e.target.value })}
                  placeholder="e.g. 48500"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  Sanctioned Estimate: ₹{parseFloat(String(selectedTicket.estimated_amount || 0)).toLocaleString('en-IN')}
                </span>
              </div>

              <div>
                <label className="font-bold text-slate-600 dark:text-slate-300 block mb-1">Award Remarks / LOI Details</label>
                <textarea
                  rows={2}
                  value={awardData.remarks}
                  onChange={(e) => setAwardData({ ...awardData, remarks: e.target.value })}
                  placeholder="e.g. Lowest tenderer L1 approved by competent authority; work order issued..."
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setAwardModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition disabled:opacity-50"
                >
                  {submitting ? 'Awarding...' : 'Confirm Contract Award'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: VIEW WORK SCOPE DETAILS */}
      {detailsModalOpen && selectedTicket && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-xl border border-slate-200 dark:border-slate-700 space-y-4 max-h-[90vh] overflow-y-auto animate-in fade-in duration-150 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
              <div>
                <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                  #TKT-{selectedTicket.id.toString().padStart(4, '0')}
                </span>
                <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                  {selectedTicket.title || selectedTicket.description}
                </h3>
              </div>
              <button onClick={() => setDetailsModalOpen(false)} className="p-1 rounded-lg text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            {loadingDetails || !ticketDetails ? (
              <div className="p-8 text-center text-slate-400">Loading technical work order details...</div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Department</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{ticketDetails.department}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Sanctioned Amount</span>
                    <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      ₹{parseFloat(String(ticketDetails.report?.estimated_amount || 0)).toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Current Stage</span>
                    <span className="font-semibold text-blue-600 dark:text-blue-400">{ticketDetails.status}</span>
                  </div>
                </div>

                <div>
                  <h4 className="font-bold text-slate-700 dark:text-slate-300 mb-1">Technical Work Scope (JE Report)</h4>
                  <p className="p-3 bg-slate-50 dark:bg-slate-900/40 rounded-xl text-slate-600 dark:text-slate-300">
                    {ticketDetails.report?.nature_of_work || 'No detailed technical notes on file.'}
                  </p>
                </div>

                {ticketDetails.tenders && ticketDetails.tenders.length > 0 && (
                  <div>
                    <h4 className="font-bold text-slate-700 dark:text-slate-300 mb-1">Tender Records</h4>
                    <div className="space-y-2">
                      {ticketDetails.tenders.map((tn: any) => (
                        <div key={tn.id} className="p-3 rounded-xl bg-cyan-500/5 border border-cyan-500/20">
                          <div className="flex justify-between font-bold text-cyan-800 dark:text-cyan-300 mb-1">
                            <span>NIT: {tn.nit_number} ({tn.portal_type})</span>
                            <span>{tn.status}</span>
                          </div>
                          {tn.awarded_agency && (
                            <p className="text-slate-700 dark:text-slate-300">
                              Awarded To: <strong>{tn.awarded_agency}</strong> {tn.work_order_value && `(INR ${parseFloat(tn.work_order_value).toLocaleString('en-IN')})`}
                            </p>
                          )}
                          {tn.remarks && <p className="text-slate-500 mt-1">{tn.remarks}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
