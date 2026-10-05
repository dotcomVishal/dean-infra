import { useNavigate } from 'react-router-dom';
import { PlusCircle } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import DeskBoard from '../../components/DeskBoard';

export default function JeDashboard() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  return (
    <div className="max-w-6xl mx-auto space-y-8 w-full animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">JE Dashboard</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-medium">{user?.name} · {user?.department}</p>
        </div>
        <button
          onClick={() => navigate('/je/raise')}
          className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-semibold shadow-sm transition-all flex items-center gap-2 text-sm justify-center active:scale-[0.98]"
        >
          <PlusCircle size={18} /> New proposal
        </button>
      </div>

      <DeskBoard />
    </div>
  );
}
