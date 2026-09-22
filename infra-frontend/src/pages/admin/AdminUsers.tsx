import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { 
  Users, Search, PlusCircle, Edit3, X, RefreshCw, 
  CheckCircle2, XCircle
} from 'lucide-react';
import { api } from '../../services/api';

const ALL_USER_DEPARTMENTS = [
  'Civil', 
  'Electrical', 
  'Horticulture', 
  'Stores & Purchase', 
  'Finance & Accounts', 
  'Computer Center', 
  'Administration', 
  'General'
];

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

interface UserItem {
  id: number;
  firebase_uid: string;
  name: string;
  full_name?: string;
  email: string;
  role: string;
  department: string;
  phone: string | null;
  is_active: boolean | number;
  created_at: string;
}

export default function AdminUsers() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');

  // Modals state
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
  const [isSaving, setIsSaving] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (search.trim()) params.search = search.trim();
      if (roleFilter && roleFilter !== 'ALL') params.role = roleFilter;
      if (deptFilter && deptFilter !== 'ALL') params.department = deptFilter;

      const res = await api.get('/admin/users', { params });
      if (res.data.success) {
        setUsers(res.data.users || []);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [roleFilter, deptFilter]);

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

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserData.email || !newUserData.full_name) {
      alert('Please fill out email and full name.');
      return;
    }

    setIsSaving(true);
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
      }
    } catch (err: any) {
      console.error('Create user error:', err);
      alert(err.response?.data?.message || 'Failed to create user account.');
    } finally {
      setIsSaving(false);
    }
  };

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

  const handleSaveEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    setIsSaving(true);
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
      setIsSaving(false);
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'SYSADMIN':
        return 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20';
      case 'DIRECTOR':
      case 'DEAN':
        return 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20';
      case 'SE':
      case 'AE':
        return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20';
      case 'JE':
        return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';
      case 'ACCOUNTANT':
        return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
      case 'CLERICAL':
        return 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20';
      default:
        return 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20';
    }
  };

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6 animate-in fade-in duration-200 pb-16">
      
      {/* Header */}
      <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md p-6 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-700/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <Users size={22} />
            </span>
            <div>
              <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white">
                User Account Management
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Role provisioning, engineering wing assignments, and institutional access control
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setCreateUserModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition shadow-sm"
          >
            <PlusCircle size={15} />
            Create Account
          </button>
          <button
            onClick={fetchUsers}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-700/60 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="flex-1 w-full flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchUsers()}
              placeholder="Search users by name, email, or phone..."
              className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs md:text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-200 focus:outline-none"
          >
            <option value="">All Roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>

          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
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
      </div>

      {/* Users Table */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">Loading user accounts...</div>
        ) : users.length === 0 ? (
          <div className="p-12 text-center text-slate-400">No users match your criteria.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-900/30 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Department / Wing</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Registered Date</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-900/40 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center font-bold text-xs uppercase">
                          {u.name ? u.name.substring(0, 2) : 'US'}
                        </div>
                        <div>
                          <p className="font-bold text-slate-900 dark:text-white">{u.name}</p>
                          <p className="text-[11px] text-slate-400">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${getRoleBadge(u.role)}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap font-medium text-slate-700 dark:text-slate-300">
                      {u.department}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {Boolean(u.is_active) ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 size={13} /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-500">
                          <XCircle size={13} /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-slate-400 text-[11px]">
                      {u.created_at ? format(new Date(u.created_at), 'dd MMM yyyy') : '—'}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        onClick={() => handleOpenEditUser(u)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition"
                        title="Edit User Account"
                      >
                        <Edit3 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Create User Account */}
      {createUserModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 dark:border-slate-700 space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <PlusCircle className="text-emerald-600" size={18} /> Provision User Account
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
                  placeholder="e.g. Er. Ramesh Kumar"
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
                  disabled={isSaving}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-50"
                >
                  {isSaving ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit User Account */}
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
                  disabled={isSaving}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
