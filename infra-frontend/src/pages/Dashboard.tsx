import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, PlusCircle, ArrowRight, Activity, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';

interface Ticket {
  id: number;
  department: string;
  description: string;
  status: string;
  created_at: string;
  estimated_amount?: string;
}

export default function Dashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        let endpoint = '/tickets/applicant'; 
        if (['AE', 'SE', 'DEAN', 'DIRECTOR'].includes(user?.role || '')) endpoint = '/tickets/queue';
        else if (user?.role === 'JE') endpoint = '/tickets/je/dashboard';

        const response = await api.get(endpoint);
        setTickets(response.data.tickets || []);
      } catch (err) {
        console.error('Failed to load tickets', err);
      } finally {
        setLoading(false);
      }
    };
    fetchDashboardData();
  }, [user]);

  // --- STAT CALCULATIONS ---
  const openTickets = tickets.filter(t => t.status.includes('PENDING') || t.status === 'ASSIGNED_TO_JE');
  const sanctionedTickets = tickets.filter(t => t.status.includes('APPROVED'));
  const rejectedTickets = tickets.filter(t => t.status.includes('RETURNED') || t.status === 'DENIED');
  
  const totalSanctionedAmount = sanctionedTickets.reduce((sum, t) => {
    return sum + (t.estimated_amount ? parseFloat(t.estimated_amount) : 0);
  }, 0);

  const getStatusStyle = (status: string) => {
    if (status.includes('PENDING') || status === 'ASSIGNED_TO_JE') 
      return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800/50';
    if (status.includes('APPROVED') || status === 'CLOSED') 
      return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 border-green-200 dark:border-green-800/50';
    if (status === 'DENIED' || status.includes('RETURNED')) 
      return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 border-red-200 dark:border-red-800/50';
    return 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';
  };

  const getStageLabel = (status: string) => {
    if (status === 'ASSIGNED_TO_JE') return 'L1 - Junior Eng.';
    if (status === 'PENDING_AE_APPROVAL') return 'L2 - Assistant Eng.';
    if (status === 'PENDING_SE_APPROVAL') return 'L3 - Superintending Eng.';
    if (status === 'PENDING_DEAN_APPROVAL') return 'L4 - Dean';
    if (status === 'PENDING_DIRECTOR_APPROVAL') return 'L5 - Director';
    if (status.includes('APPROVED')) return 'Infra / Clerical';
    return 'Returned / Closed';
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-blue-600 dark:text-blue-400">
        <Loader2 className="animate-spin" size={40} />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
            {greeting}, {user?.name.split(' ')[0]}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-medium">
            {user?.role} · {user?.department} Department
          </p>
        </div>
        
        {user?.role === 'APPLICANT' && (
          <button onClick={() => navigate('/raise')} className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-semibold shadow-sm transition-all flex items-center gap-2 text-sm w-full md:w-auto justify-center">
            <PlusCircle size={18} /> Report an issue
          </button>
        )}
      </div>

      {/* STAT CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm">
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2"><Clock size={14}/> Open Tickets</div>
          <div className="text-3xl font-black text-slate-900 dark:text-white">{openTickets.length}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-medium">Currently in your scope</div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm">
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2"><Activity size={14}/> With Prep Staff</div>
          <div className="text-3xl font-black text-slate-900 dark:text-white">
            {tickets.filter(t => t.status === 'APPROVED_FOR_TENDERING').length}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-medium">Awaiting external tender</div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm">
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2"><CheckCircle2 size={14}/> Sanctioned</div>
          <div className="text-3xl font-black text-slate-900 dark:text-white">{sanctionedTickets.length}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-medium">
            {user?.role === 'APPLICANT' ? 'All time approved' : `₹${totalSanctionedAmount.toLocaleString('en-IN')} total estimated`}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm">
          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2"><XCircle size={14}/> Rejected / Returned</div>
          <div className="text-3xl font-black text-slate-900 dark:text-white">{rejectedTickets.length}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-medium">Requires revision</div>
        </div>
      </div>

      {/* RECENT ACTIVITY TABLE */}
      <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-gray-100 dark:border-slate-700 flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Recent Activity</h2>
          <Link to="/tickets" className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 flex items-center gap-1">
            View all <ArrowRight size={16} />
          </Link>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-900/50 text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-5 py-4">Ticket</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4">Current Desk</th>
                {user?.role !== 'APPLICANT' && <th className="px-5 py-4">Estimate</th>}
                <th className="px-5 py-4 text-right">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50 font-medium">
              {tickets.slice(0, 5).map((ticket) => (
                <tr key={ticket.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors cursor-pointer" onClick={() => navigate(`/ticket/${ticket.id}`)}>
                  <td className="px-5 py-4">
                    <div className="text-blue-600 dark:text-blue-400 font-mono text-xs mb-1">#TKT-{ticket.id.toString().padStart(4, '0')}</div>
                    <div className="truncate max-w-[200px] md:max-w-xs">{ticket.description}</div>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${getStatusStyle(ticket.status)}`}>
                      {ticket.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-5 py-4 font-mono text-xs">{getStageLabel(ticket.status)}</td>
                  
                  {/* HIDE FINANCIALS FROM APPLICANTS */}
                  {user?.role !== 'APPLICANT' && (
                    <td className="px-5 py-4">
                      {ticket.estimated_amount ? `₹${parseFloat(ticket.estimated_amount).toLocaleString('en-IN')}` : '---'}
                    </td>
                  )}
                  
                  <td className="px-5 py-4 text-right text-xs text-slate-400">
                    {format(new Date(ticket.created_at), 'MMM dd, yyyy, HH:mm')}
                  </td>
                </tr>
              ))}
              {tickets.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-slate-400">No recent activity found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}