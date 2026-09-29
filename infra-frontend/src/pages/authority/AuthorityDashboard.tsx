import { ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import DeskBoard from '../../components/DeskBoard';

const TITLE: Record<string, string> = {
  AE: 'Assistant Engineer (AE) desk',
  SE: 'Superintending Engineer (SE) desk',
  DEAN: 'Dean of Infrastructure desk',
  DIRECTOR: 'Director’s desk',
};

// Decisions are taken on the ticket page, from the actions the API offers for
// that ticket. This page only lists work; sanction limits come from the API.
export default function AuthorityDashboard() {
  const user = useAuthStore((s) => s.user);
  const role = user?.role ?? 'AE';
  const wide = role === 'DEAN' || role === 'DIRECTOR' || role === 'SE';

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 pb-16 animate-in fade-in duration-300">
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 md:p-6">
        <span className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-2 text-blue-600 dark:text-blue-400"><ShieldCheck size={22} /></span>
        <div className="min-w-0">
          <h1 className="text-lg font-black text-slate-900 dark:text-white md:text-2xl">{TITLE[role] ?? 'Approval desk'}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {user?.name}{wide ? ' · All engineering departments' : ` · ${user?.department ?? ''} department`}
          </p>
        </div>
      </div>
      <DeskBoard allWorks={wide ? 'All campus works' : 'Department works'} />
    </div>
  );
}
