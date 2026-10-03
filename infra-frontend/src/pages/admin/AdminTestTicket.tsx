import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../../services/api';
import { toast } from '../../store/toastStore';
import { TEST_ROLES, useTestModeStore, type TestRole } from '../../store/testModeStore';
import { deskLabel, errorMessage, staffStatusLabel, ticketNo } from '../../lib/ticketUi';
import TicketDetails from '../TicketDetails';

interface TestTicket { id: number; department: string; campus: string; status: string; created_at: string }

const fieldCls =
  'rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-900 dark:text-white';

/**
 * One test ticket, switchable between roles. Every request goes through the real
 * API with X-Test-Role, so the buttons, redaction and messages come from the server.
 */
export default function AdminTestTicket() {
  const { ticketId, actAs, set, clear } = useTestModeStore();
  const [tickets, setTickets] = useState<TestTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [department, setDepartment] = useState('Civil');
  const [campus, setCampus] = useState('NORTH');
  const [estimate, setEstimate] = useState('');
  // Bumped after reset so the ticket view reloads.
  const [version, setVersion] = useState(0);

  const loadList = useCallback(async () => {
    try {
      const res = await api.get('/admin/test-tickets');
      setTickets(res.data.tickets);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not load test tickets.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  // Leaving the page ends test mode, so no other request can carry the header.
  useEffect(() => () => clear(), [clear]);

  const open = (id: number, role: TestRole = actAs ?? 'JE') => set(id, role);

  const create = async () => {
    setBusy(true);
    try {
      const res = await api.post('/admin/test-tickets', {
        department, campus, ...(estimate.trim() ? { estimate: Number(estimate) } : {}),
      });
      toast.success('Test ticket created.');
      await loadList();
      open(res.data.ticket_id, 'JE');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not create the test ticket.'));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (ticketId === null) return;
    setBusy(true);
    try {
      await api.post(`/admin/test-tickets/${ticketId}/reset`);
      toast.success('Test ticket reset.');
      setVersion((v) => v + 1);
      await loadList();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not reset the test ticket.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (ticketId === null || !window.confirm(`Delete test ticket ${ticketNo(ticketId)}?`)) return;
    setBusy(true);
    try {
      await api.delete(`/admin/test-tickets/${ticketId}`);
      toast.success('Test ticket deleted.');
      clear();
      await loadList();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete the test ticket.'));
    } finally {
      setBusy(false);
    }
  };

  const current = tickets.find((t) => t.id === ticketId);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 pb-16">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-white md:text-2xl">
          <FlaskConical size={22} className="text-blue-600" /> Test Ticket
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Walk one ticket through every role. No mail is sent and nothing shows in reports.</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 md:p-6">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Department
            <select value={department} onChange={(e) => setDepartment(e.target.value)} className={`${fieldCls} mt-1 block`}>
              {['Civil', 'Electrical', 'Horticulture'].map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Campus
            <select value={campus} onChange={(e) => setCampus(e.target.value)} className={`${fieldCls} mt-1 block`}>
              {['NORTH', 'SOUTH'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Estimate (₹, optional)
            <input inputMode="decimal" value={estimate} onChange={(e) => setEstimate(e.target.value)} className={`${fieldCls} mt-1 block w-40`} placeholder="e.g. 75000" />
          </label>
          <button onClick={create} disabled={busy}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Create
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {loading ? <Loader2 size={16} className="animate-spin text-slate-400" /> : tickets.length === 0 ? (
            <p className="text-sm text-slate-500">No test tickets yet.</p>
          ) : tickets.map((t) => (
            <button key={t.id} onClick={() => open(t.id)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${t.id === ticketId
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700'}`}>
              {ticketNo(t.id)} · {t.department} · {staffStatusLabel(t.status)}
            </button>
          ))}
        </div>
      </section>

      {ticketId !== null && actAs !== null && (
        <>
          <div role="status" className="sticky top-16 z-30 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-amber-400 bg-amber-50 px-4 py-3 shadow-sm dark:border-amber-600 dark:bg-amber-950/40">
            <span className="text-sm font-bold text-amber-900 dark:text-amber-200">
              Test mode — viewing as {deskLabel(actAs)}
            </span>
            <select value={actAs} onChange={(e) => open(ticketId, e.target.value as TestRole)} aria-label="Role to play" className={fieldCls}>
              {TEST_ROLES.map((r) => <option key={r} value={r}>{deskLabel(r)}</option>)}
            </select>
            <span className="text-xs text-amber-800 dark:text-amber-300">{current ? staffStatusLabel(current.status) : ''}</span>
            <div className="ml-auto flex gap-2">
              <button onClick={reset} disabled={busy} className="flex items-center gap-1.5 rounded-xl border border-amber-500 px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:text-amber-200 dark:hover:bg-amber-900/40">
                <RotateCcw size={14} /> Reset
              </button>
              <button onClick={remove} disabled={busy} className="flex items-center gap-1.5 rounded-xl border border-rose-500 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-300 dark:hover:bg-rose-950/40">
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </div>
          <TicketDetails key={`${ticketId}-${actAs}-${version}`} ticketId={ticketId} roleOverride={actAs} />
        </>
      )}
    </div>
  );
}
