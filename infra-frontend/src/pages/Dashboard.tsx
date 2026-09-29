import { useNavigate } from 'react-router-dom';
import { PlusCircle } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import DeskBoard from '../components/DeskBoard';

export default function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 pb-16">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white md:text-3xl">
            {greeting}, {user?.name?.split(' ')[0]}
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">Track the issues you have reported.</p>
        </div>
        <button onClick={() => navigate('/raise')}
          className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700">
          <PlusCircle size={18} /> Report an issue
        </button>
      </div>
      <DeskBoard />
    </div>
  );
}
