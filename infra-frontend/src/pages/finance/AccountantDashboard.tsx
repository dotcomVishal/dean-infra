import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  Search, RefreshCw, FileText, PlusCircle,
  Clock, CheckCircle2, X,
  Receipt, Landmark
} from 'lucide-react';
import { api } from '../../services/api';

interface FinanceTicket {
  id: number;
  title: string | null;
  description: string;
  department: string;
  type: string;
  status: string;
  created_at: string;
  applicant_name: string;
  estimated_amount: number | string | null;
  nature_of_work: string | null;
  nit_number?: string | null;
  awarded_agency?: string | null;
  work_order_value?: number | string | null;
  total_billed_amount: number | string | null;
  bills_count: number;
}

interface BillItem {
  id: number;
  ticket_id: number;
  bill_number: string;
  voucher_number: string | null;
  agency_name: string;
  bill_type: string;
  gross_amount: number | string;
  deductions: number | string;
  net_amount: number | string;
  payment_status: string;
  payment_date: string | null;
  payment_mode: string;
  remarks: string | null;
  accountant_name?: string;
  created_at: string;
}

interface FinanceSummary {
  totalSanctioned: number;
  totalContractValue: number;
  totalDisbursed: number;
  totalPendingDisbursement: number;
  totalBillsCount: number;
}

export default function AccountantDashboard() {
  const [activeTab, setActiveTab] = useState<'sanctioned' | 'wip' | 'closed' | 'all'>('sanctioned');
  const [tickets, setTickets] = useState<FinanceTicket[]>([]);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [billModalOpen, setBillModalOpen] = useState(false);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<FinanceTicket | null>(null);
  const [ticketBills, setTicketBills] = useState<BillItem[]>([]);
  const [loadingBills, setLoadingBills] = useState(false);

  // Bill entry form state
  const [billData, setBillData] = useState({
    bill_number: '',
    voucher_number: '',
    agency_name: '',
    bill_type: 'RA_BILL',
    gross_amount: '',
    deductions: '0',
    net_amount: '',
    payment_status: 'PENDING',
    payment_date: format(new Date(), 'yyyy-MM-dd'),
    payment_mode: 'PFMS',
    remarks: ''
  });
  const [submittingBill, setSubmittingBill] = useState(false);

  // Fetch Financial Overview
  const fetchOverview = async () => {
    try {
      const res = await api.get('/tickets/accountant/overview');
      if (res.data.success) {
        setSummary(res.data.summary);
      }
    } catch (err) {
      console.error('Failed to load financial overview:', err);
    }
  };

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
      console.error('Failed to load tickets queue:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  useEffect(() => {
    fetchTickets();
  }, [activeTab]);

  // Handle Gross / Deduction calculation
  const handleGrossChange = (gross: string) => {
    const g = parseFloat(gross) || 0;
    const d = parseFloat(billData.deductions) || 0;
    setBillData({
      ...billData,
      gross_amount: gross,
      net_amount: String(Math.max(0, g - d))
    });
  };

  const handleDeductionsChange = (deductions: string) => {
    const g = parseFloat(billData.gross_amount) || 0;
    const d = parseFloat(deductions) || 0;
    setBillData({
      ...billData,
      deductions: deductions,
      net_amount: String(Math.max(0, g - d))
    });
  };

  // Open Record Bill Modal
  const handleOpenRecordBill = (ticket: FinanceTicket) => {
    setSelectedTicket(ticket);
    setBillData({
      bill_number: `BILL/${new Date().getFullYear()}/${ticket.id.toString().padStart(4, '0')}-${ticket.bills_count + 1}`,
      voucher_number: '',
      agency_name: ticket.awarded_agency || '',
      bill_type: 'RA_BILL',
      gross_amount: '',
      deductions: '0',
      net_amount: '',
      payment_status: 'PENDING',
      payment_date: format(new Date(), 'yyyy-MM-dd'),
      payment_mode: 'PFMS',
      remarks: ''
    });
    setBillModalOpen(true);
  };

  // Submit Bill
  const handleSubmitBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !billData.bill_number || !billData.agency_name || !billData.net_amount) {
      alert('Please fill out all mandatory bill parameters.');
      return;
    }

    setSubmittingBill(true);
    try {
      const res = await api.post(`/tickets/${selectedTicket.id}/bills`, billData);
      if (res.data.success) {
        alert('Bill & Voucher recorded in financial accounts ledger.');
        setBillModalOpen(false);
        fetchTickets();
        fetchOverview();
      }
    } catch (err: any) {
      console.error('Record bill error:', err);
      alert(err.response?.data?.message || 'Failed to record bill.');
    } finally {
      setSubmittingBill(false);
    }
  };

  // Open Ticket Bills Details Modal
  const handleOpenDetails = async (ticket: FinanceTicket) => {
    setSelectedTicket(ticket);
    setDetailsModalOpen(true);
    setLoadingBills(true);
    try {
      const res = await api.get(`/tickets/${ticket.id}/bills`);
      if (res.data.success) {
        setTicketBills(res.data.bills || []);
      }
    } catch (err) {
      console.error('Failed to load ticket bills:', err);
    } finally {
      setLoadingBills(false);
    }
  };

  // Update Bill Status (e.g. Disburse payment)
  const handleUpdatePayment = async (billId: number, payment_status: string) => {
    const voucher = prompt('Enter Disbursement Voucher Number (e.g. PFMS/VCH-4491):');
    if (voucher === null) return;

    try {
      const res = await api.patch(`/tickets/bills/${billId}`, {
        payment_status,
        voucher_number: voucher.trim() || undefined,
        payment_date: format(new Date(), 'yyyy-MM-dd')
      });
      if (res.data.success) {
        alert('Payment status updated successfully.');
        if (selectedTicket) {
          const bRes = await api.get(`/tickets/${selectedTicket.id}/bills`);
          setTicketBills(bRes.data.bills || []);
        }
        fetchTickets();
        fetchOverview();
      }
    } catch (err: any) {
      console.error('Update payment error:', err);
      alert(err.response?.data?.message || 'Failed to update payment.');
    }
  };

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6 animate-in fade-in duration-300 pb-16">
      
      {/* Top Header Card */}
      <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md p-6 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-700/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <Landmark size={22} />
            </span>
            <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white">
              Finance & Accounts Audit Desk
            </h1>
          </div>
          <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-1">
            Capital Expenditure Verification · Running Account (RA) Bills · Voucher Ledger & PFMS Disbursements
          </p>
        </div>

        <button
          onClick={() => {
            fetchOverview();
            fetchTickets();
          }}
          className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition self-start md:self-auto shadow-sm"
        >
          <RefreshCw size={14} /> Refresh Ledger
        </button>
      </div>

      {/* Financial KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
          <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1 flex items-center gap-1">
            <Landmark size={13} className="text-blue-500" /> Total Sanctioned Outlay
          </span>
          <p className="text-xl md:text-2xl font-black text-slate-900 dark:text-white font-mono">
            ₹{(summary?.totalSanctioned || 0).toLocaleString('en-IN')}
          </p>
          <span className="text-[10px] text-slate-500">Approved by competent authority</span>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
          <span className="text-[10px] uppercase font-bold text-cyan-600 dark:text-cyan-400 block mb-1 flex items-center gap-1">
            <Receipt size={13} /> Awarded Contract Values
          </span>
          <p className="text-xl md:text-2xl font-black text-cyan-700 dark:text-cyan-300 font-mono">
            ₹{(summary?.totalContractValue || 0).toLocaleString('en-IN')}
          </p>
          <span className="text-[10px] text-slate-500">Active agency commitments</span>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
          <span className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400 block mb-1 flex items-center gap-1">
            <CheckCircle2 size={13} /> Total Disbursed
          </span>
          <p className="text-xl md:text-2xl font-black text-emerald-700 dark:text-emerald-300 font-mono">
            ₹{(summary?.totalDisbursed || 0).toLocaleString('en-IN')}
          </p>
          <span className="text-[10px] text-slate-500">PFMS / Bank payments cleared</span>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
          <span className="text-[10px] uppercase font-bold text-amber-600 dark:text-amber-400 block mb-1 flex items-center gap-1">
            <Clock size={13} /> Pending Disbursement
          </span>
          <p className="text-xl md:text-2xl font-black text-amber-700 dark:text-amber-300 font-mono">
            ₹{(summary?.totalPendingDisbursement || 0).toLocaleString('en-IN')}
          </p>
          <span className="text-[10px] text-slate-500">{summary?.totalBillsCount || 0} bills booked in total</span>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex flex-wrap gap-1 p-1.5 bg-slate-200/60 dark:bg-slate-800/60 backdrop-blur-md rounded-2xl border border-slate-200/80 dark:border-slate-700/80">
        <button
          onClick={() => setActiveTab('sanctioned')}
          className={`px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all flex items-center gap-2 ${
            activeTab === 'sanctioned'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <Landmark size={16} /> Sanctioned Works Ledger
        </button>

        <button
          onClick={() => setActiveTab('wip')}
          className={`px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all flex items-center gap-2 ${
            activeTab === 'wip'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <Clock size={16} /> Works In Execution (Under Billing)
        </button>

        <button
          onClick={() => setActiveTab('closed')}
          className={`px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all flex items-center gap-2 ${
            activeTab === 'closed'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <CheckCircle2 size={16} /> Financially Settled Works
        </button>

        <button
          onClick={() => setActiveTab('all')}
          className={`px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all flex items-center gap-2 ${
            activeTab === 'all'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <FileText size={16} /> Complete Accounts Directory
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
            placeholder="Search by ticket ID, work title, or agency name..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs md:text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={fetchTickets}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition shadow-sm"
        >
          Filter
        </button>
      </div>

      {/* Tickets & Billing Table */}
      {loading ? (
        <div className="p-12 text-center text-slate-400">Loading accounts ledger...</div>
      ) : tickets.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-slate-400">
          No works found for this financial category.
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/70 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 text-[11px] uppercase font-bold text-slate-400">
                  <th className="py-3 px-4">Ticket</th>
                  <th className="py-3 px-4">Work Description</th>
                  <th className="py-3 px-4">Department</th>
                  <th className="py-3 px-4">Sanctioned Outlay</th>
                  <th className="py-3 px-4">Agency & Contract</th>
                  <th className="py-3 px-4">Billed Amount</th>
                  <th className="py-3 px-4 text-right">Accounts Actions</th>
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
                        {t.title || t.description}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">
                        {t.description}
                      </p>
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 font-semibold text-[10px] text-slate-700 dark:text-slate-300">
                        {t.department}
                      </span>
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap font-mono">
                      {t.estimated_amount ? (
                        <span className="font-bold text-slate-900 dark:text-white">
                          ₹{parseFloat(String(t.estimated_amount)).toLocaleString('en-IN')}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      {t.awarded_agency ? (
                        <div>
                          <p className="font-semibold text-slate-800 dark:text-slate-200">{t.awarded_agency}</p>
                          {t.work_order_value && (
                            <span className="font-mono text-[10px] text-slate-500">
                              WO: ₹{parseFloat(String(t.work_order_value)).toLocaleString('en-IN')}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">Not Awarded</span>
                      )}
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap font-mono">
                      <div>
                        <span className="font-bold text-emerald-600 dark:text-emerald-400 block">
                          ₹{parseFloat(String(t.total_billed_amount || 0)).toLocaleString('en-IN')}
                        </span>
                        <span className="text-[10px] text-slate-400 font-sans">
                          {t.bills_count} bills booked
                        </span>
                      </div>
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap text-right space-x-1.5">
                      <button
                        onClick={() => handleOpenDetails(t)}
                        className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition"
                        title="View Bills Ledger"
                      >
                        <Receipt size={14} />
                      </button>

                      <button
                        onClick={() => handleOpenRecordBill(t)}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition shadow-sm inline-flex items-center gap-1"
                      >
                        <PlusCircle size={12} /> Book Bill
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL 1: RECORD NEW BILL & VOUCHER */}
      {billModalOpen && selectedTicket && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 dark:border-slate-700 space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Receipt className="text-emerald-600" size={18} /> Record Bill & Payment Voucher
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  #TKT-{selectedTicket.id.toString().padStart(4, '0')} · {selectedTicket.title || selectedTicket.description}
                </p>
              </div>
              <button onClick={() => setBillModalOpen(false)} className="p-1 rounded-lg text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmitBill} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-600 dark:text-slate-300 block mb-1">Bill Reference Number</label>
                  <input
                    type="text"
                    value={billData.bill_number}
                    onChange={(e) => setBillData({ ...billData, bill_number: e.target.value })}
                    required
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-600 dark:text-slate-300 block mb-1">Bill Classification</label>
                  <select
                    value={billData.bill_type}
                    onChange={(e) => setBillData({ ...billData, bill_type: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none"
                  >
                    <option value="RA_BILL">Running Account (RA) Bill</option>
                    <option value="FINAL_BILL">Final Bill</option>
                    <option value="ADVANCE">Mobilization Advance</option>
                    <option value="SECURITY_REFUND">Security Deposit Refund</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-600 dark:text-slate-300 block mb-1">Contractor / Agency Name</label>
                <input
                  type="text"
                  value={billData.agency_name}
                  onChange={(e) => setBillData({ ...billData, agency_name: e.target.value })}
                  placeholder="e.g. M/s Prime Infra Solutions"
                  required
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-bold text-slate-600 dark:text-slate-300 block mb-1">Gross Amount (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={billData.gross_amount}
                    onChange={(e) => handleGrossChange(e.target.value)}
                    placeholder="e.g. 50000"
                    required
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-600 dark:text-slate-300 block mb-1">Deductions (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={billData.deductions}
                    onChange={(e) => handleDeductionsChange(e.target.value)}
                    placeholder="TDS/GST"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-mono text-slate-900 dark:text-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-600 dark:text-slate-300 block mb-1">Net Payable (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={billData.net_amount}
                    readOnly
                    className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-mono font-bold text-emerald-600 dark:text-emerald-400 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-600 dark:text-slate-300 block mb-1">Payment Status</label>
                  <select
                    value={billData.payment_status}
                    onChange={(e) => setBillData({ ...billData, payment_status: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none"
                  >
                    <option value="PENDING">Pending Approval</option>
                    <option value="VERIFIED">Verified for Payment</option>
                    <option value="DISBURSED">Disbursed / Paid</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-600 dark:text-slate-300 block mb-1">Payment Mode</label>
                  <select
                    value={billData.payment_mode}
                    onChange={(e) => setBillData({ ...billData, payment_mode: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none"
                  >
                    <option value="PFMS">PFMS Transfer</option>
                    <option value="RTGS">RTGS / NEFT</option>
                    <option value="CHEQUE">Bank Cheque</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-600 dark:text-slate-300 block mb-1">Voucher Number (Optional)</label>
                <input
                  type="text"
                  value={billData.voucher_number}
                  onChange={(e) => setBillData({ ...billData, voucher_number: e.target.value })}
                  placeholder="e.g. PFMS/VCH-9921"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-mono text-slate-900 dark:text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="font-bold text-slate-600 dark:text-slate-300 block mb-1">Accountant Audit Remarks</label>
                <textarea
                  rows={2}
                  value={billData.remarks}
                  onChange={(e) => setBillData({ ...billData, remarks: e.target.value })}
                  placeholder="e.g. MB verified; TDS @2% deducted; statutory deductions applied..."
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setBillModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingBill}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition disabled:opacity-50"
                >
                  {submittingBill ? 'Recording...' : 'Commit Bill to Ledger'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: VIEW TICKET BILLS LEDGER */}
      {detailsModalOpen && selectedTicket && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-3xl w-full p-6 shadow-xl border border-slate-200 dark:border-slate-700 space-y-4 max-h-[90vh] overflow-y-auto animate-in fade-in duration-150 text-xs">
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

            <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Sanctioned Outlay</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                  ₹{parseFloat(String(selectedTicket.estimated_amount || 0)).toLocaleString('en-IN')}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Billed</span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                  ₹{parseFloat(String(selectedTicket.total_billed_amount || 0)).toLocaleString('en-IN')}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Agency</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block">
                  {selectedTicket.awarded_agency || 'N/A'}
                </span>
              </div>
            </div>

            <div>
              <h4 className="font-bold text-slate-700 dark:text-slate-300 mb-2">Processed Bills Ledger</h4>
              {loadingBills ? (
                <div className="p-6 text-center text-slate-400">Loading bills...</div>
              ) : ticketBills.length === 0 ? (
                <div className="p-6 text-center bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-dashed border-slate-200 text-slate-400">
                  No bills have been booked for this ticket yet.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {ticketBills.map((b) => (
                    <div key={b.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-900 dark:text-white">{b.bill_number}</span>
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[10px] font-semibold">
                            {b.bill_type.replace('_', ' ')}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            b.payment_status === 'DISBURSED'
                              ? 'bg-emerald-500/10 text-emerald-600'
                              : 'bg-amber-500/10 text-amber-600'
                          }`}>
                            {b.payment_status}
                          </span>
                        </div>
                        <p className="text-slate-500 text-[11px] mt-1">
                          Agency: <strong>{b.agency_name}</strong> {b.voucher_number && `· Voucher: ${b.voucher_number}`} · {format(new Date(b.created_at), 'PPP')}
                        </p>
                        {b.remarks && <p className="text-slate-600 dark:text-slate-400 mt-1 italic">{b.remarks}</p>}
                      </div>

                      <div className="flex sm:flex-col items-end justify-between shrink-0 font-mono">
                        <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                          ₹{parseFloat(String(b.net_amount)).toLocaleString('en-IN')}
                        </span>
                        {b.payment_status !== 'DISBURSED' && (
                          <button
                            onClick={() => handleUpdatePayment(b.id, 'DISBURSED')}
                            className="text-[10px] text-blue-600 dark:text-blue-400 underline font-sans font-semibold mt-1"
                          >
                            Mark Disbursed
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
