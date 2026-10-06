import { useAuthStore } from '../../store/authStore';
import DeskBoard from '../../components/DeskBoard';

const TITLE: Record<string, string> = {
  AE: 'AE Approvals',
  SE: 'SE Approvals',
  DEAN: 'Dean Approvals',
  DIRECTOR: 'Director Approvals',
};

// Decisions are taken on the ticket page, from the actions the API offers for
// that ticket. This page only lists work; sanction limits come from the API.
export default function AuthorityDashboard() {
  const user = useAuthStore((s) => s.user);
  const role = user?.role ?? 'AE';
  const wide = role === 'DEAN' || role === 'DIRECTOR' || role === 'SE';

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 pb-16 animate-in fade-in duration-300">
      <div>
        <h1 className="text-lg font-black text-slate-900 dark:text-white md:text-2xl">{TITLE[role] ?? 'Approvals'}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {user?.name}{wide ? ' · All departments' : ` · ${user?.department ?? ''}`}
        </p>
      </div>
      <DeskBoard allWorks={wide ? 'All tickets' : 'Department tickets'} />
    </div>
  );
}
