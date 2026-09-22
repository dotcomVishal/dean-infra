import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Loader2, Search, ChevronLeft, ChevronRight, Filter, ArrowUpDown } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';

export default function MyTickets() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filtering & Sorting State
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('All');
  const [sortOrder, setSortOrder] = useState('newest'); // 'newest' or 'oldest'
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    if (user?.role === 'SYSADMIN') {
      navigate('/admin/tickets', { replace: true });
      return;
    }

    const fetchTickets = async () => {
      try {
        let endpoint = '/tickets/applicant'; 
        if (['AE', 'SE', 'DEAN', 'DIRECTOR', 'CLERICAL', 'ACCOUNTANT'].includes(user?.role || '')) endpoint = '/tickets/queue';
        else if (user?.role === 'JE') endpoint = '/tickets/je/dashboard';

        const response = await api.get(endpoint);
        setTickets(response.data.tickets || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchTickets();
  }, [user, navigate]);

  // --- FILTER & SORT LOGIC ---
  const processedTickets = tickets.filter(t => {
    const searchLower = search.toLowerCase();
    const matchesSearch = (t.title && t.title.toLowerCase().includes(searchLower)) ||
                          t.description.toLowerCase().includes(searchLower) || 
                          t.id.toString().includes(search);
    const matchesDept = deptFilter === 'All' || t.department === deptFilter;
    return matchesSearch && matchesDept;
  });

  processedTickets.sort((a, b) => {
    const dateA = new Date(a.created_at).getTime();
    const dateB = new Date(b.created_at).getTime();
    return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
  });

  // Calculate Pagination on the *processed* array
  const totalPages = Math.ceil(processedTickets.length / itemsPerPage);
  const currentTickets = processedTickets.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const getStatusStyle = (status: string) => {
    if (status.includes('PENDING') || status === 'ASSIGNED_TO_JE') return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800/50';
    if (status.includes('APPROVED') || status === 'CLOSED') return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 border-green-200 dark:border-green-800/50';
    return 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 w-full">
      
      {/* Header & Controls */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Ticket Directory</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Found {processedTickets.length} records</p>
        </div>
        
        <div className="flex flex-col md:flex-row w-full xl:w-auto gap-3">
          {/* Search Bar */}
          <div className="relative w-full md:w-72">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search by ID or keywords..." 
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
              className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-white transition-all"
            />
          </div>

          {/* Department Filter */}
          <div className="relative w-full md:w-48">
            <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select 
              value={deptFilter}
              onChange={(e) => { setDeptFilter(e.target.value); setCurrentPage(1); }}
              className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-white appearance-none cursor-pointer transition-all"
            >
              <option value="All">All Departments</option>
              <option value="Civil">Civil</option>
              <option value="Electrical">Electrical</option>
              <option value="Horticulture">Horticulture</option>
            </select>
          </div>

          {/* Date Sort */}
          <button 
            onClick={() => setSortOrder(prev => prev === 'newest' ? 'oldest' : 'newest')}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            <ArrowUpDown size={16} />
            {sortOrder === 'newest' ? 'Newest First' : 'Oldest First'}
          </button>
        </div>
      </div>

      {/* Ticket List */}
      {loading ? (
        <div className="flex h-[40vh] items-center justify-center"><Loader2 className="animate-spin text-blue-500" size={32} /></div>
      ) : processedTickets.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 border border-dashed border-gray-300 dark:border-slate-700 rounded-2xl p-16 text-center text-slate-500 dark:text-slate-400 font-medium">
          No tickets match your filters.
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden flex flex-col">
          
          {/* Desktop Table Header */}
          <div className="hidden md:grid grid-cols-12 gap-4 p-4 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            <div className="col-span-2">Ticket ID</div>
            <div className="col-span-4">Description</div>
            <div className="col-span-2">Department</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2 text-right">Date Reported</div>
          </div>

          <ul className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {currentTickets.map((ticket) => (
              <li 
                key={ticket.id} 
                onClick={() => navigate(`/ticket/${ticket.id}`)}
                className="p-4 md:p-5 hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors cursor-pointer group"
              >
                {/* Mobile View */}
                <div className="md:hidden flex flex-col gap-2">
                  <div className="flex justify-between items-start">
                    <span className="text-blue-600 dark:text-blue-400 font-mono text-sm font-bold">#TKT-{ticket.id.toString().padStart(4, '0')}</span>
                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-md border ${getStatusStyle(ticket.status)}`}>
                      {ticket.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white line-clamp-1">{ticket.title || ticket.description}</h3>
                    {ticket.title && <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">{ticket.description}</p>}
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 font-medium pt-1">
                    <span>{ticket.department} Dept.</span>
                    <span>{format(new Date(ticket.created_at), 'MMM dd, yyyy')}</span>
                  </div>
                </div>

                {/* Desktop View */}
                <div className="hidden md:grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-2 text-blue-600 dark:text-blue-400 font-mono text-sm font-bold group-hover:underline">
                    #TKT-{ticket.id.toString().padStart(4, '0')}
                  </div>
                  <div className="col-span-4 pr-4">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">{ticket.title || ticket.description}</div>
                    {ticket.title && <div className="text-xs text-slate-400 truncate">{ticket.description}</div>}
                  </div>
                  <div className="col-span-2 text-sm text-slate-600 dark:text-slate-400 font-medium">
                    {ticket.department}
                  </div>
                  <div className="col-span-2">
                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-md border ${getStatusStyle(ticket.status)}`}>
                      {ticket.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="col-span-2 text-right text-sm text-slate-500 dark:text-slate-400 font-medium">
                    {format(new Date(ticket.created_at), 'MMM dd, yyyy')}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          
          {/* Pagination Controls */}
          <div className="p-4 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
            <span className="text-sm text-slate-500 dark:text-slate-400 font-medium">
              Page {currentPage} of {totalPages || 1}
            </span>
            <div className="flex gap-2">
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-4 py-2 flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-50 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium text-sm transition-colors"
              >
                <ChevronLeft size={16} /> Prev
              </button>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages || totalPages === 0}
                className="px-4 py-2 flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-50 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium text-sm transition-colors"
              >
                Next <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}