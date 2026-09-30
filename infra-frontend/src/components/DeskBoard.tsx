import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Building2, Eye, Inbox, Loader2, RefreshCw, User, UserX } from 'lucide-react';
import { api } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { toast } from '../store/toastStore';
import {
  applicantStage, deskLabel, errorMessage, formatAge, hoursSince, inr, SLA_CLASS, slaOf, staffStatusLabel, ticketNo,
} from '../lib/ticketUi';

interface Row {
  id: number;
  title?: string | null;
  description?: string;
  department: string;
  campus?: string | null;
  priority?: string | null;
  status: string;
  stage_label?: string;
  created_at: string;
  desk_since?: string;
  estimated_amount?: number | string | null;
  on_my_desk?: boolean;
  applicant_name?: string;
  current_holder_name?: string | null;
  current_desk?: string | null;
}
interface Board {
  my_desk: Row[];
  watching: Row[];
  my_tickets: Row[];
  approval_limit: { can_approve: boolean; unlimited: boolean; amount: number | null } | null;
}
type TabKey = 'desk' | 'watching' | 'mine' | 'all';

function TicketRow({ t, mode, now }: { t: Row; mode: TabKey; now: number }) {
  const navigate = useNavigate();
  const since = t.desk_since ?? t.created_at;
  const hours = hoursSince(since, now);
  const sla = mode === 'desk' ? slaOf(hours) : null;
  const unassigned = t.status === 'UNASSIGNED';
  const foreign = mode === 'desk' && t.on_my_desk === false;

  return (
    <li>
      <button
        type="button"
        onClick={() => navigate(`/ticket/${t.id}`)}
        className={`relative flex w-full items-stretch gap-3 rounded-xl border border-slate-200 bg-white p-3 pl-4 text-left shadow-sm transition hover:border-blue-300 hover:shadow dark:border-slate-700 dark:bg-slate-800 dark:hover:border-blue-700 ${foreign ? 'opacity-70' : ''}`}
      >
        {sla && <span aria-hidden className={`absolute inset-y-0 left-0 w-1.5 rounded-l-xl ${SLA_CLASS[sla].bar}`} />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">{ticketNo(t.id)}</span>
            {t.campus && <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300">{t.campus}</span>}
            <span className="flex items-center gap-1 text-[11px] font-medium text-slate-500"><Building2 size={11} />{t.department}</span>
            {t.priority === 'URGENT' && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-800 dark:bg-rose-900/30 dark:text-rose-300">Urgent</span>}
            {unassigned && (
              <span className="flex items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-violet-800 dark:bg-violet-900/30 dark:text-violet-300">
                <UserX size={10} /> Needs a JE
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-white">{t.title || t.description || 'Untitled ticket'}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
            {mode === 'mine' ? applicantStage(t.status, t.stage_label) : staffStatusLabel(t.status)}
            {mode !== 'mine' && t.estimated_amount != null && <> · <span className="font-mono">{inr(t.estimated_amount)}</span></>}
            {mode !== 'mine' && t.current_holder_name && <> · With {t.current_holder_name}{t.current_desk ? ` (${deskLabel(t.current_desk)})` : ''}</>}
            {t.applicant_name && mode === 'all' && <> · {t.applicant_name}</>}
            {foreign && ' · with another AE'}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end justify-between gap-1">
          {sla ? (
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${SLA_CLASS[sla].chip}`} title={SLA_CLASS[sla].text}>
              {formatAge(hours)}
            </span>
          ) : (
            <span className="text-[10px] font-medium text-slate-400">{format(new Date(mode === 'mine' ? t.created_at : since), 'd MMM')}</span>
          )}
          <Eye size={14} className="text-slate-300" />
        </div>
      </button>
    </li>
  );
}

/**
 * Role dashboard body: My desk (with SLA ageing colours), Watching, My tickets.
 * The AE's My desk includes the UNASSIGNED queue (the API puts it there).
 * The approval limit is displayed from the API, never hardcoded.
 */
export default function DeskBoard({ allWorks }: { allWorks?: string }) {
  const role = useAuthStore((s) => s.user?.role) ?? 'APPLICANT';
  const isStaff = role !== 'APPLICANT';
  const [board, setBoard] = useState<Board | null>(null);
  const [all, setAll] = useState<Row[] | null>(null);
  const [tab, setTab] = useState<TabKey>(isStaff ? 'desk' : 'mine');
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/tickets/desk');
      setBoard(res.data);
      setNow(Date.now());
    } catch (err) {
      toast.error(errorMessage(err, 'Could not load your tickets.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (tab !== 'all' || all !== null) return;
    api.get('/tickets/queue', { params: { tab: 'all' } })
      .then((r) => setAll(r.data.tickets ?? []))
      .catch((e) => { setAll([]); toast.error(errorMessage(e, 'Could not load the works list.')); });
  }, [tab, all]);

  const rows: Row[] = tab === 'desk' ? board?.my_desk ?? [] : tab === 'watching' ? board?.watching ?? []
    : tab === 'mine' ? board?.my_tickets ?? [] : all ?? [];

  const counts = useMemo(() => {
    const c = { ok: 0, warn: 0, late: 0 };
    (board?.my_desk ?? []).forEach((t) => { c[slaOf(hoursSince(t.desk_since ?? t.created_at, now))] += 1; });
    return c;
  }, [board, now]);

  const tabs: { key: TabKey; label: string; n?: number }[] = [
    ...(isStaff ? [
      { key: 'desk' as const, label: 'My desk', n: board?.my_desk.length },
      { key: 'watching' as const, label: 'Watching', n: board?.watching.length },
    ] : []),
    { key: 'mine', label: 'My tickets', n: board?.my_tickets.length },
    ...(allWorks ? [{ key: 'all' as const, label: allWorks }] : []),
  ];

  const limit = board?.approval_limit;
  const empty: Record<TabKey, string> = {
    desk: 'Nothing is waiting for you.',
    watching: 'Tickets you handled will appear here while they are still open.',
    mine: 'You have not raised any tickets.',
    all: 'No tickets found.',
  };

  return (
    <div className="space-y-4">
      {limit?.can_approve && (
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Your approval limit:{' '}
          <span className="font-mono font-bold text-slate-900 dark:text-white">
            {limit.unlimited ? 'Unlimited' : limit.amount == null ? 'not configured' : inr(limit.amount)}
          </span>
        </p>
      )}

      <div className="flex items-center gap-2">
        <div role="tablist" className="flex flex-1 gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-200/60 p-1.5 dark:border-slate-700 dark:bg-slate-800/60">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`flex min-h-[2.5rem] shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${
                tab === t.key ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white/60 dark:text-slate-400 dark:hover:bg-slate-700/50'}`}
            >
              {t.label}
              {t.n != null && <span className={`rounded-full px-1.5 text-[11px] ${tab === t.key ? 'bg-white/20' : 'bg-slate-300/60 dark:bg-slate-700'}`}>{t.n}</span>}
            </button>
          ))}
        </div>
        <button onClick={load} aria-label="Refresh" className="rounded-xl bg-slate-100 p-2.5 text-slate-700 transition hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {tab === 'desk' && rows.length > 0 && (
        <div className="flex flex-wrap gap-2 text-[11px] font-bold">
          {(['late', 'warn', 'ok'] as const).map((k) => (
            <span key={k} className={`rounded-full border px-2.5 py-1 ${SLA_CLASS[k].chip}`}>{counts[k]} {SLA_CLASS[k].text.toLowerCase()}</span>
          ))}
        </div>
      )}

      {loading && !board ? (
        <div className="flex justify-center py-16 text-blue-500"><Loader2 className="animate-spin" size={32} /></div>
      ) : (tab === 'all' && all === null) ? (
        <div className="flex justify-center py-16 text-blue-500"><Loader2 className="animate-spin" size={32} /></div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-800">
          {tab === 'mine' ? <User size={26} /> : <Inbox size={26} />}
          {empty[tab]}
        </div>
      ) : (
        <ul className="space-y-2">{rows.map((t) => <TicketRow key={t.id} t={t} mode={tab} now={now} />)}</ul>
      )}
    </div>
  );
}
