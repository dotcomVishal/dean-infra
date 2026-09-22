import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  ShieldAlert, Users, FileText, Clock, IndianRupee,
  RefreshCw, Search, Edit3, UserPlus, Eye, X, Wrench, Layers
} from 'lucide-react';
import { api } from '../../services/api';

// Types
interface AdminMetrics {
  totalTickets: number;
  pendingInspection: number;
  awaitingApproval: number;
  inTendering: number;
  closed: number;
  totalEstimatedAmount: number;
  totalApprovedAmount: number;
  usersCount: number;
  byDepartment: Array<{ department: string; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
  activeJes: Array<{ id: number; full_name: string; email: string; department: string; active_tickets_count: number }>;
}

interface TicketItem {
  id: number;
  title: string | null;
  description: string;
  department: string;
  type: string;
  nature_of_work: string | null;
  status: string;
  priority: string;
  created_at: string;
  applicant_name: string;
  applicant_email: string;
  assigned_je_name: string | null;
  assigned_je_email: string | null;
  assigned_to_user_id: number | null;
  estimated_amount: number | null;
  approved_amount: number | null;
}

interface UserItem {
  id: number;
  name?: string;
  full_name?: string;
  email: string;
  role: string;
  department: string;
  phone?: string;
  is_active: number | boolean;
  created_at: string;
}

interface AuditLogItem {
  id: number;
  ticket_id: number;
  action: string;
  performed_by_name: string;
  performed_by_role: string;
  previous_status: string | null;
  new_status: string | null;
  remarks: string | null;
  created_at: string;
}

interface JEItem {
  id: number;
  full_name: string;
  email: string;
  department: string;
  active_tickets_count: number;
}

const ALL_STATUSES = [
  'SUBMITTED',
  'ASSIGNED_TO_JE',
  'PENDING_AE_APPROVAL',
  'PENDING_SE_APPROVAL',
  'PENDING_DEAN_APPROVAL',
  'PENDING_DIRECTOR_APPROVAL',
  'APPROVED_FOR_TENDERING',
  'TENDER_PUBLISHED',
  'WORK_IN_PROGRESS',
  'CLOSED',
  'REJECTED',
  'RETURNED_FOR_CORRECTION'
];

const TICKET_DEPARTMENTS = ['Civil', 'Electrical', 'Horticulture'];
const ALL_USER_DEPARTMENTS = ['Civil', 'Electrical', 'Horticulture', 'Stores & Purchase', 'Finance & Accounts', 'Computer Center', 'Administration', 'General'];
const ROLES = ['APPLICANT', 'JE', 'AE', 'SE', 'DEAN', 'DIRECTOR', 'SYSADMIN', 'CLERICAL', 'ACCOUNTANT'];

export const getDepartmentsForRole = (role: string): string[] => {
  switch (role) {
    case 'JE':
      // A JE strictly belongs to one of the 3 engineering wings
      return ['Civil', 'Electrical', 'Horticulture'];
    case 'AE':
      return ['Civil', 'Electrical', 'Horticulture'];
    case 'SE':
    case 'DEAN':
    case 'DIRECTOR':
      return ['General', 'Administration', 'Civil', 'Electrical'];
    case 'CLERICAL':
      return ['Stores & Purchase', 'Administration', 'General'];
    case 'ACCOUNTANT':
      return ['Finance & Accounts', 'Administration', 'General'];
    case 'SYSADMIN':
      return ['Computer Center', 'Administration', 'General'];
    case 'APPLICANT':
    default:
      return ['General', 'Civil', 'Electrical', 'Horticulture', 'Administration'];
  }
};

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<'overview' | 'tickets' | 'users' | 'audit'>('overview');

  // Metrics state
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(true);

  // Tickets state
  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [ticketSearch, setTicketSearch] = useState('');
  const [ticketStatusFilter, setTicketStatusFilter] = useState('');
  const [ticketDeptFilter, setTicketDeptFilter] = useState('');

  // Ticket override & detail modal
  const [selectedTicket, setSelectedTicket] = useState<TicketItem | null>(null);
  const [masterTicketDetails, setMasterTicketDetails] = useState<any | null>(null);
  const [loadingTicketDetails, setLoadingTicketDetails] = useState(false);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);

  const [overrideStatus, setOverrideStatus] = useState('');
  const [overrideJeId, setOverrideJeId] = useState<string>('');
  const [overrideRemarks, setOverrideRemarks] = useState('');
  const [isSubmittingOverride, setIsSubmittingOverride] = useState(false);

  // Users state
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('');
  const [userDeptFilter, setUserDeptFilter] = useState('');
  
  // User create & edit modals
  const [createUserModalOpen, setCreateUserModalOpen] = useState(false);
  const [editUserModalOpen, setEditUserModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);

  const [newUserData, setNewUserData] = useState({
    email: '',
    full_name: '',
    role: 'APPLICANT',
    department: 'General'
  });
  const [editUserData, setEditUserData] = useState({
    full_name: '',
    role: '',
    department: '',
    is_active: true
  });
  const [isSavingUser, setIsSavingUser] = useState(false);

  // Audit state
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditTicketIdFilter, setAuditTicketIdFilter] = useState('');

  // JEs list for reassignment
  const [jes, setJes] = useState<JEItem[]>([]);

  // 1. Fetch Metrics
  const fetchMetrics = async () => {
    setLoadingMetrics(true);
    try {
      const res = await api.get('/admin/metrics');
      if (res.data.success) {
        setMetrics(res.data.metrics);
      }
    } catch (err) {
      console.error('Failed to load admin metrics:', err);
    } finally {
      setLoadingMetrics(false);
    }
  };

  // 2. Fetch Tickets
  const fetchTickets = async () => {
    setLoadingTickets(true);
    try {
      const params: any = { limit: 100 };
      if (ticketSearch.trim()) params.search = ticketSearch.trim();
      if (ticketStatusFilter) params.status = ticketStatusFilter;
      if (ticketDeptFilter) params.department = ticketDeptFilter;

      const res = await api.get('/admin/tickets', { params });
      if (res.data.success) {
        setTickets(res.data.tickets);
      }
    } catch (err) {
      console.error('Failed to load master tickets:', err);
    } finally {
      setLoadingTickets(false);
    }
  };

  // 3. Fetch Users
  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const params: any = { limit: 150 };
      if (userSearch.trim()) params.search = userSearch.trim();
      if (userRoleFilter) params.role = userRoleFilter;
      if (userDeptFilter) params.department = userDeptFilter;

      const res = await api.get('/admin/users', { params });
      if (res.data.success) {
        setUsers(res.data.users);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  // 4. Fetch Audit Logs
  const fetchAuditLogs = async () => {
    setLoadingAudit(true);
    try {
      const params: any = { limit: 150 };
      if (auditTicketIdFilter.trim()) params.ticket_id = auditTicketIdFilter.trim();

      const res = await api.get('/admin/audit-logs', { params });
      if (res.data.success) {
        setAuditLogs(res.data.logs);
      }
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoadingAudit(false);
    }
  };

  // 5. Fetch JEs
  const fetchJes = async () => {
    try {
      const res = await api.get('/admin/jes');
      if (res.data.success) {
        setJes(res.data.jes);
      }
    } catch (err) {
      console.error('Failed to load JEs list:', err);
    }
  };

  // Initial load
  useEffect(() => {
    fetchMetrics();
    fetchJes();
  }, []);

  // Trigger sub-tab loads
  useEffect(() => {
    if (activeTab === 'tickets') fetchTickets();
    if (activeTab === 'users') fetchUsers();
    if (activeTab === 'audit') fetchAuditLogs();
  }, [activeTab]);

  // Open ticket details modal
  const handleOpenTicketDetails = async (ticket: TicketItem) => {
    setSelectedTicket(ticket);
    setDetailsModalOpen(true);
    setLoadingTicketDetails(true);
    try {
      const res = await api.get(`/admin/tickets/${ticket.id}`);
      if (res.data.success) {
        setMasterTicketDetails(res.data);
      }
    } catch (err) {
      console.error('Failed to load unredacted ticket details:', err);
    } finally {
      setLoadingTicketDetails(false);
    }
  };

  // Open override modal
  const handleOpenOverride = (ticket: TicketItem) => {
    setSelectedTicket(ticket);
    setOverrideStatus(ticket.status);
    setOverrideJeId(ticket.assigned_to_user_id ? String(ticket.assigned_to_user_id) : '');
    setOverrideRemarks('');
    setOverrideModalOpen(true);
  };

  // Execute Status & JE Override
  const handleSubmitOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket) return;
    if (!overrideRemarks.trim()) {
      alert('Mandatory requirement: System Admin remarks are strictly required for audit trails.');
      return;
    }

    setIsSubmittingOverride(true);
    try {
      const payload: any = {
        remarks: overrideRemarks.trim()
      };
      if (overrideStatus && overrideStatus !== selectedTicket.status) {
        payload.status = overrideStatus;
      }
      if (overrideJeId !== '') {
        payload.assigned_to_user_id = overrideJeId ? parseInt(overrideJeId, 10) : null;
      }

      const res = await api.post(`/admin/tickets/${selectedTicket.id}/override`, payload);
      if (res.data.success) {
        alert('Master override executed successfully. Audit log recorded.');
        setOverrideModalOpen(false);
        fetchTickets();
        fetchMetrics();
      }
    } catch (err: any) {
      console.error('Override error:', err);
      alert(err.response?.data?.message || 'Failed to execute override.');
    } finally {
      setIsSubmittingOverride(false);
    }
  };

  // Handlers for dependent role-department mapping
  const handleRoleChangeForNewUser = (newRole: string) => {
    const validDepts = getDepartmentsForRole(newRole);
    const isCurrentValid = validDepts.includes(newUserData.department);
    setNewUserData({
      ...newUserData,
      role: newRole,
      department: isCurrentValid ? newUserData.department : validDepts[0]
    });
  };

  const handleRoleChangeForEditUser = (newRole: string) => {
    const validDepts = getDepartmentsForRole(newRole);
    const isCurrentValid = validDepts.includes(editUserData.department);
    setEditUserData({
      ...editUserData,
      role: newRole,
      department: isCurrentValid ? editUserData.department : validDepts[0]
    });
  };

  // Create User
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserData.email || !newUserData.full_name) {
      alert('Please fill out email and full name.');
      return;
    }

    setIsSavingUser(true);
    try {
      const res = await api.post('/admin/users', {
        email: newUserData.email.trim(),
        name: newUserData.full_name.trim(),
        full_name: newUserData.full_name.trim(),
        role: newUserData.role,
        department: newUserData.department
      });
      if (res.data.success) {
        alert('User account created successfully.');
        setCreateUserModalOpen(false);
        setNewUserData({
          email: '',
          full_name: '',
          role: 'APPLICANT',
          department: 'General'
        });
        fetchUsers();
        fetchMetrics();
      }
    } catch (err: any) {
      console.error('Create user error:', err);
      alert(err.response?.data?.message || 'Failed to create user account.');
    } finally {
      setIsSavingUser(false);
    }
  };

  // Open Edit User
  const handleOpenEditUser = (u: UserItem) => {
    setSelectedUser(u);
    const validDepts = getDepartmentsForRole(u.role);
    const isCurrentValid = validDepts.includes(u.department);
    setEditUserData({
      full_name: u.name || u.full_name || '',
      role: u.role,
      department: isCurrentValid ? u.department : validDepts[0],
      is_active: Boolean(u.is_active)
    });
    setEditUserModalOpen(true);
  };

  // Save Edit User
  const handleSaveEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    setIsSavingUser(true);
    try {
      const payload: any = {
        name: editUserData.full_name.trim(),
        full_name: editUserData.full_name.trim(),
        role: editUserData.role,
        department: editUserData.department,
        is_active: editUserData.is_active
      };

      const res = await api.put(`/admin/users/${selectedUser.id}`, payload);
      if (res.data.success) {
        alert('User account updated successfully.');
        setEditUserModalOpen(false);
        fetchUsers();
      }
    } catch (err: any) {
      console.error('Update user error:', err);
      alert(err.response?.data?.message || 'Failed to update user.');
    } finally {
      setIsSavingUser(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6 animate-in fade-in duration-300 pb-16">
      
      {/* Top Header Card */}
      <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md p-6 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-700/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
              <ShieldAlert size={22} />
            </span>
            <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white">
              System Admin Master Console
            </h1>
          </div>
          <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-1">
            Institutional IIT Mandi Infrastructure Management · Unrestricted Master Control & Audit Stream
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            onClick={() => {
              if (activeTab === 'overview') fetchMetrics();
              if (activeTab === 'tickets') fetchTickets();
              if (activeTab === 'users') fetchUsers();
              if (activeTab === 'audit') fetchAuditLogs();
            }}
            className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Institutional Tab Pills */}
      <div className="flex flex-wrap gap-1 p-1.5 bg-slate-200/60 dark:bg-slate-800/60 backdrop-blur-md rounded-2xl border border-slate-200/80 dark:border-slate-700/80">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2.5 rounded-xl text-xs md:text-sm font-semibold transition-all flex items-center gap-2 ${
            activeTab === 'overview'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <Layers size={16} /> Overview & Metrics
        </button>

        <button
          onClick={() => setActiveTab('tickets')}
          className={`px-4 py-2.5 rounded-xl text-xs md:text-sm font-semibold transition-all flex items-center gap-2 ${
            activeTab === 'tickets'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <FileText size={16} /> Master Ticket Control
        </button>

        <button
          onClick={() => setActiveTab('users')}
          className={`px-4 py-2.5 rounded-xl text-xs md:text-sm font-semibold transition-all flex items-center gap-2 ${
            activeTab === 'users'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <Users size={16} /> User Accounts & Roles
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          className={`px-4 py-2.5 rounded-xl text-xs md:text-sm font-semibold transition-all flex items-center gap-2 ${
            activeTab === 'audit'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <Clock size={16} /> System Audit Stream
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: OVERVIEW & SYSTEM METRICS */}
      {/* ========================================================================= */}
      {activeTab === 'overview' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {loadingMetrics ? (
            <div className="p-12 text-center text-slate-400">Loading system metrics...</div>
          ) : !metrics ? (
            <div className="p-12 text-center text-slate-400">Failed to load metrics.</div>
          ) : (
            <>
              {/* Stat Counters Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
                  <span className="text-[11px] uppercase font-bold text-slate-400">Total Tickets</span>
                  <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 font-mono">
                    {metrics.totalTickets}
                  </p>
                  <span className="text-[10px] text-slate-500">All registered work</span>
                </div>

                <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
                  <span className="text-[11px] uppercase font-bold text-amber-500">Inspection</span>
                  <p className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1 font-mono">
                    {metrics.pendingInspection}
                  </p>
                  <span className="text-[10px] text-slate-500">Pending JE visit</span>
                </div>

                <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
                  <span className="text-[11px] uppercase font-bold text-indigo-500">Sanctions</span>
                  <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1 font-mono">
                    {metrics.awaitingApproval}
                  </p>
                  <span className="text-[10px] text-slate-500">In AE / SE / Dean queue</span>
                </div>

                <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
                  <span className="text-[11px] uppercase font-bold text-cyan-500">Tendering / WIP</span>
                  <p className="text-2xl font-black text-cyan-600 dark:text-cyan-400 mt-1 font-mono">
                    {metrics.inTendering}
                  </p>
                  <span className="text-[10px] text-slate-500">Active contracts</span>
                </div>

                <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
                  <span className="text-[11px] uppercase font-bold text-emerald-500">Closed</span>
                  <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1 font-mono">
                    {metrics.closed}
                  </p>
                  <span className="text-[10px] text-slate-500">Completed & verified</span>
                </div>

                <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
                  <span className="text-[11px] uppercase font-bold text-slate-400">Total Accounts</span>
                  <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 font-mono">
                    {metrics.usersCount}
                  </p>
                  <span className="text-[10px] text-slate-500">Authorized staff</span>
                </div>
              </div>

              {/* Financial Outlay & JE Workload */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Financial Summary Card */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-4">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <IndianRupee size={16} className="text-emerald-600 dark:text-emerald-400" />
                    Capital Expenditure & Sanctions
                  </h3>
                  
                  <div className="space-y-3 pt-2">
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700">
                      <span className="text-[11px] font-bold text-slate-400 uppercase block">Total Estimated Outlay</span>
                      <span className="text-xl font-black text-slate-800 dark:text-slate-100 font-mono">
                        ₹{(metrics.totalEstimatedAmount || 0).toLocaleString('en-IN')}
                      </span>
                    </div>

                    <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                      <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 uppercase block">Total Sanctioned / Approved</span>
                      <span className="text-xl font-black text-emerald-700 dark:text-emerald-400 font-mono">
                        ₹{(metrics.totalApprovedAmount || 0).toLocaleString('en-IN')}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Department Breakdown</h4>
                    <div className="space-y-1.5">
                      {(metrics?.byDepartment || []).map((d) => (
                        <div key={d.department} className="flex items-center justify-between text-xs py-1 border-b border-slate-100 dark:border-slate-700/60">
                          <span className="font-medium text-slate-700 dark:text-slate-300">{d.department}</span>
                          <span className="font-mono font-bold text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-md">
                            {d.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* JE Operational Distribution Table */}
                <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-700/80 shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <Wrench size={16} className="text-blue-600 dark:text-blue-400" />
                      Junior Engineer (JE) Active Workloads
                    </h3>
                    <span className="text-xs text-slate-500 font-medium">
                      {(metrics?.activeJes || []).length} Active JEs
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-700 text-[11px] uppercase font-bold text-slate-400">
                          <th className="py-2.5 px-3">Engineer</th>
                          <th className="py-2.5 px-3">Department</th>
                          <th className="py-2.5 px-3">Active Tickets</th>
                          <th className="py-2.5 px-3 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                        {(metrics?.activeJes || []).map((je) => (
                          <tr key={je.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-700/30">
                            <td className="py-2.5 px-3">
                              <p className="font-bold text-slate-900 dark:text-white">{je.full_name}</p>
                              <p className="text-[11px] text-slate-500">{je.email}</p>
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 font-semibold text-[10px] text-slate-700 dark:text-slate-300">
                                {je.department}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-slate-800 dark:text-slate-200">
                              {je.active_tickets_count} pending
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                je.active_tickets_count > 5
                                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                  : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              }`}>
                                {je.active_tickets_count > 5 ? 'High Load' : 'Available'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            </>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: MASTER TICKET CONTROL */}
      {/* ========================================================================= */}
      {activeTab === 'tickets' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          
          {/* Filter Bar */}
          <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                value={ticketSearch}
                onChange={(e) => setTicketSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchTickets()}
                placeholder="Search by ticket ID, title, applicant name, or description..."
                className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs md:text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <select
                value={ticketStatusFilter}
                onChange={(e) => setTicketStatusFilter(e.target.value)}
                className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Statuses</option>
                {ALL_STATUSES.map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                ))}
              </select>

              <select
                value={ticketDeptFilter}
                onChange={(e) => setTicketDeptFilter(e.target.value)}
                className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Departments</option>
                {TICKET_DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>

              <button
                onClick={fetchTickets}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-sm transition"
              >
                Filter
              </button>
            </div>
          </div>

          {/* Tickets List */}
          {loadingTickets ? (
            <div className="p-12 text-center text-slate-400">Loading tickets list...</div>
          ) : tickets.length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-slate-400">
              No tickets found matching your query.
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50/70 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 text-[11px] uppercase font-bold text-slate-400">
                      <th className="py-3 px-4">Ticket</th>
                      <th className="py-3 px-4">Title & Details</th>
                      <th className="py-3 px-4">Applicant</th>
                      <th className="py-3 px-4">Assigned JE</th>
                      <th className="py-3 px-4">Financials</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Master Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                    {tickets.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-700/30 transition">
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="font-mono font-bold text-blue-600 dark:text-blue-400 block">
                            #TKT-{t.id.toString().padStart(4, '0')}
                          </span>
                          <span className="text-[10px] text-slate-400 font-medium">
                            {format(new Date(t.created_at), 'MMM dd, yyyy')}
                          </span>
                        </td>

                        <td className="py-3 px-4 max-w-xs">
                          <p className="font-bold text-slate-900 dark:text-white truncate">
                            {t.title || 'Untitled Ticket'}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate mt-0.5">
                            {t.description}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-[9px] font-semibold text-slate-600 dark:text-slate-300">
                              {t.department}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-[9px] font-semibold">
                              {t.type}
                            </span>
                          </div>
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          <p className="font-semibold text-slate-800 dark:text-slate-200">{t.applicant_name}</p>
                          <p className="text-[10px] text-slate-400">{t.applicant_email}</p>
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          {t.assigned_je_name ? (
                            <div>
                              <p className="font-semibold text-slate-800 dark:text-slate-200">{t.assigned_je_name}</p>
                              <p className="text-[10px] text-slate-400">{t.assigned_je_email}</p>
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-400 italic">Unassigned</span>
                          )}
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap font-mono">
                          {t.estimated_amount ? (
                            <div>
                              <span className="text-slate-900 dark:text-white font-bold block">
                                ₹{parseFloat(String(t.estimated_amount)).toLocaleString('en-IN')}
                              </span>
                              {t.approved_amount && (
                                <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                                  Appr: ₹{parseFloat(String(t.approved_amount)).toLocaleString('en-IN')}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 text-[11px]">-</span>
                          )}
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            t.status === 'CLOSED'
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20'
                              : t.status.includes('PENDING')
                              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20'
                              : t.status === 'ASSIGNED_TO_JE'
                              ? 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20'
                              : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                          }`}>
                            {t.status.replace(/_/g, ' ')}
                          </span>
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap text-right space-x-1.5">
                          <button
                            onClick={() => handleOpenTicketDetails(t)}
                            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition"
                            title="Unredacted Master View"
                          >
                            <Eye size={15} />
                          </button>

                          <button
                            onClick={() => handleOpenOverride(t)}
                            className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 hover:bg-rose-100 text-[11px] font-bold transition border border-rose-500/20 inline-flex items-center gap-1"
                            title="Override Status & Reassign JE"
                          >
                            <ShieldAlert size={13} /> Override
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: USER ACCOUNTS & ROLES */}
      {/* ========================================================================= */}
      {activeTab === 'users' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          
          {/* Header Controls */}
          <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
            <div className="flex-1 w-full flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchUsers()}
                  placeholder="Search users by name or email..."
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs md:text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <select
                value={userRoleFilter}
                onChange={(e) => setUserRoleFilter(e.target.value)}
                className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-200 focus:outline-none"
              >
                <option value="">All Roles</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>

              <select
                value={userDeptFilter}
                onChange={(e) => setUserDeptFilter(e.target.value)}
                className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-200 focus:outline-none"
              >
                <option value="">All Departments</option>
                {ALL_USER_DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>

              <button
                onClick={fetchUsers}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition shadow-sm"
              >
                Filter
              </button>
            </div>

            <button
              onClick={() => setCreateUserModalOpen(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-sm self-end md:self-auto"
            >
              <UserPlus size={15} /> Add Account
            </button>
          </div>

          {/* Users Table */}
          {loadingUsers ? (
            <div className="p-12 text-center text-slate-400">Loading user accounts...</div>
          ) : users.length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-slate-400">
              No users found matching your query.
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50/70 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 text-[11px] uppercase font-bold text-slate-400">
                      <th className="py-3 px-4">User</th>
                      <th className="py-3 px-4">Role</th>
                      <th className="py-3 px-4">Department</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Joined Date</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-700/30 transition">
                        <td className="py-3 px-4">
                          <p className="font-bold text-slate-900 dark:text-white">{u.name || u.full_name}</p>
                          <p className="text-[11px] text-slate-500">{u.email}</p>
                        </td>

                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded-md font-semibold text-[10px] ${
                            u.role === 'SYSADMIN'
                              ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20 font-bold'
                              : u.role === 'DIRECTOR' || u.role === 'DEAN'
                              ? 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-500/20'
                              : u.role === 'JE'
                              ? 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border border-cyan-500/20'
                              : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                          }`}>
                            {u.role}
                          </span>
                        </td>

                        <td className="py-3 px-4">
                          <span className="font-medium text-slate-700 dark:text-slate-300">
                            {u.department}
                          </span>
                        </td>

                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            u.is_active
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                          }`}>
                            {u.is_active ? 'Active' : 'Disabled'}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                          {format(new Date(u.created_at), 'MMM dd, yyyy')}
                        </td>

                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleOpenEditUser(u)}
                            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition"
                            title="Edit Role & Status"
                          >
                            <Edit3 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: SYSTEM AUDIT STREAM */}
      {/* ========================================================================= */}
      {activeTab === 'audit' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          
          {/* Header Controls */}
          <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative flex-1 w-full max-w-xs">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="number"
                value={auditTicketIdFilter}
                onChange={(e) => setAuditTicketIdFilter(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchAuditLogs()}
                placeholder="Filter by Ticket ID..."
                className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs md:text-sm text-slate-900 dark:text-white focus:outline-none"
              />
            </div>

            <button
              onClick={fetchAuditLogs}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition shadow-sm"
            >
              Filter Logs
            </button>
          </div>

          {/* Audit Logs Stream */}
          {loadingAudit ? (
            <div className="p-12 text-center text-slate-400">Loading audit log stream...</div>
          ) : auditLogs.length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-slate-400">
              No audit records found.
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50/70 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 text-[11px] uppercase font-bold text-slate-400">
                      <th className="py-3 px-4">Timestamp</th>
                      <th className="py-3 px-4">Ticket</th>
                      <th className="py-3 px-4">Action</th>
                      <th className="py-3 px-4">Actor</th>
                      <th className="py-3 px-4">Transition</th>
                      <th className="py-3 px-4">Internal Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-700/30 transition">
                        <td className="py-3 px-4 whitespace-nowrap text-slate-500 font-mono text-[11px]">
                          {format(new Date(log.created_at), 'MMM dd, HH:mm:ss')}
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                            #TKT-{log.ticket_id.toString().padStart(4, '0')}
                          </span>
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200">
                            {log.action}
                          </span>
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          <p className="font-bold text-slate-800 dark:text-slate-200">{log.performed_by_name}</p>
                          <span className="text-[10px] text-slate-400 font-mono">{log.performed_by_role}</span>
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap text-[11px]">
                          {log.previous_status && log.new_status ? (
                            <div className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                              <span className="line-through text-slate-400 text-[10px]">{log.previous_status}</span>
                              <span>→</span>
                              <span className="font-semibold text-blue-600 dark:text-blue-400">{log.new_status}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>

                        <td className="py-3 px-4 max-w-sm text-slate-700 dark:text-slate-300 text-[11px]">
                          {log.remarks ? (
                            <span className={log.remarks.includes('[SYSADMIN OVERRIDE]') ? 'text-rose-600 dark:text-rose-400 font-semibold' : ''}>
                              {log.remarks}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic">None</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: STATUS & JE OVERRIDE MODAL */}
      {/* ========================================================================= */}
      {overrideModalOpen && selectedTicket && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 dark:border-slate-700 space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <ShieldAlert className="text-rose-600" size={18} /> Master Ticket Override
                </h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  #TKT-{selectedTicket.id.toString().padStart(4, '0')} · {selectedTicket.title || selectedTicket.description}
                </p>
              </div>
              <button
                onClick={() => setOverrideModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmitOverride} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block mb-1">
                  Target Status / Milestone Override
                </label>
                <select
                  value={overrideStatus}
                  onChange={(e) => setOverrideStatus(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                >
                  {ALL_STATUSES.map((s) => (
                    <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                  ))}
                </select>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Current Status: <strong className="text-slate-700 dark:text-slate-200">{selectedTicket.status}</strong>
                </span>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block mb-1">
                  Reassign Junior Engineer (JE)
                </label>
                <select
                  value={overrideJeId}
                  onChange={(e) => setOverrideJeId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                >
                  <option value="">Leave Unassigned</option>
                  {jes.map((je) => (
                    <option key={je.id} value={String(je.id)}>
                      {je.full_name} ({je.department}) · {je.active_tickets_count} tickets
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block mb-1">
                  Master Override Remarks <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={3}
                  value={overrideRemarks}
                  onChange={(e) => setOverrideRemarks(e.target.value)}
                  placeholder="State the administrative justification for this override (will be indelibly logged in the audit ledger)..."
                  required
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setOverrideModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingOverride}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isSubmittingOverride ? 'Executing...' : 'Confirm Master Override'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: UNREDACTED MASTER TICKET DETAILS */}
      {/* ========================================================================= */}
      {detailsModalOpen && selectedTicket && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-3xl w-full p-6 shadow-xl border border-slate-200 dark:border-slate-700 space-y-4 max-h-[90vh] overflow-y-auto animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
              <div>
                <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                  #TKT-{selectedTicket.id.toString().padStart(4, '0')}
                </span>
                <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                  {selectedTicket.title || selectedTicket.description}
                </h3>
              </div>
              <button
                onClick={() => {
                  setDetailsModalOpen(false);
                  setMasterTicketDetails(null);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X size={18} />
              </button>
            </div>

            {loadingTicketDetails || !masterTicketDetails ? (
              <div className="p-8 text-center text-slate-400">Loading master records...</div>
            ) : (
              <div className="space-y-4 text-xs">
                {/* Core Ticket Information */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-700">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Department</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{masterTicketDetails.ticket.department}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Type</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{masterTicketDetails.ticket.type}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Status</span>
                    <span className="font-semibold text-blue-600 dark:text-blue-400">{masterTicketDetails.ticket.status}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Priority</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{masterTicketDetails.ticket.priority}</span>
                  </div>
                </div>

                <div>
                  <h4 className="text-[11px] uppercase font-bold text-slate-400 tracking-wider mb-1">Full Description</h4>
                  <p className="p-3 bg-slate-50 dark:bg-slate-900/40 rounded-xl text-slate-700 dark:text-slate-300">
                    {masterTicketDetails.ticket.description}
                  </p>
                </div>

                {/* Inspection Reports */}
                {masterTicketDetails.reports && masterTicketDetails.reports.length > 0 && (
                  <div>
                    <h4 className="text-[11px] uppercase font-bold text-slate-400 tracking-wider mb-1">Inspection Reports</h4>
                    <div className="space-y-2">
                      {masterTicketDetails.reports.map((r: any) => (
                        <div key={r.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
                          <div className="flex justify-between font-semibold mb-1">
                            <span>Estimated Amount: ₹{parseFloat(r.estimated_amount).toLocaleString('en-IN')}</span>
                            <span className="text-slate-500 font-normal">{format(new Date(r.created_at), 'PPP')}</span>
                          </div>
                          <p className="text-slate-600 dark:text-slate-400">{r.notes}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Audit Logs */}
                <div>
                  <h4 className="text-[11px] uppercase font-bold text-slate-400 tracking-wider mb-1">Full Audit Trail (Unredacted)</h4>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {masterTicketDetails.audit_logs?.map((log: any) => (
                      <div key={log.id} className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/30 text-[11px] border border-slate-100 dark:border-slate-700/60">
                        <div className="flex justify-between text-slate-500">
                          <span><strong>{log.performed_by_name}</strong> ({log.performed_by_role}) — {log.action}</span>
                          <span className="font-mono">{format(new Date(log.created_at), 'MMM dd, HH:mm')}</span>
                        </div>
                        {log.remarks && (
                          <p className="text-slate-700 dark:text-slate-300 mt-0.5">{log.remarks}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: CREATE USER ACCOUNT */}
      {/* ========================================================================= */}
      {createUserModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 dark:border-slate-700 space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <UserPlus className="text-emerald-600" size={18} /> Provision New Account
              </h3>
              <button
                onClick={() => setCreateUserModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block mb-1">Full Name</label>
                <input
                  type="text"
                  value={newUserData.full_name}
                  onChange={(e) => setNewUserData({ ...newUserData, full_name: e.target.value })}
                  placeholder="e.g. Er. Rajiv Verma"
                  required
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block mb-1">Email Address</label>
                <input
                  type="email"
                  value={newUserData.email}
                  onChange={(e) => setNewUserData({ ...newUserData, email: e.target.value })}
                  placeholder="name@iitmandi.ac.in"
                  required
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block mb-1">Assigned Role</label>
                  <select
                    value={newUserData.role}
                    onChange={(e) => handleRoleChangeForNewUser(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block mb-1">
                    Department {newUserData.role === 'JE' && <span className="text-[10px] text-amber-500 font-semibold">(Engineering Wing)</span>}
                  </label>
                  <select
                    value={newUserData.department}
                    onChange={(e) => setNewUserData({ ...newUserData, department: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    {getDepartmentsForRole(newUserData.role).map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setCreateUserModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingUser}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-50"
                >
                  {isSavingUser ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: EDIT USER ACCOUNT */}
      {/* ========================================================================= */}
      {editUserModalOpen && selectedUser && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 dark:border-slate-700 space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Edit3 className="text-blue-600" size={18} /> Modify User Account
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">{selectedUser.email}</p>
              </div>
              <button
                onClick={() => setEditUserModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveEditUser} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block mb-1">Full Name</label>
                <input
                  type="text"
                  value={editUserData.full_name}
                  onChange={(e) => setEditUserData({ ...editUserData, full_name: e.target.value })}
                  required
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block mb-1">Role</label>
                  <select
                    value={editUserData.role}
                    onChange={(e) => handleRoleChangeForEditUser(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block mb-1">
                    Department {editUserData.role === 'JE' && <span className="text-[10px] text-amber-500 font-semibold">(Engineering Wing)</span>}
                  </label>
                  <select
                    value={editUserData.department}
                    onChange={(e) => setEditUserData({ ...editUserData, department: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {getDepartmentsForRole(editUserData.role).map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editUserData.is_active}
                    onChange={(e) => setEditUserData({ ...editUserData, is_active: e.target.checked })}
                    className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
                  />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Account Active (uncheck to disable access)
                  </span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setEditUserModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingUser}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition disabled:opacity-50"
                >
                  {isSavingUser ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
