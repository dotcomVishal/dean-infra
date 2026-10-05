import { useEffect, useState } from 'react';
import { Loader2, Trash2, X, TriangleAlert } from 'lucide-react';
import { api } from '../../services/api';
import { toast } from '../../store/toastStore';
import { errorMessage, ticketNo } from '../../lib/ticketUi';

interface Preview {
  ticket_ref: string;
  counts: Record<string, number>;
  has_bills: boolean;
  has_award: boolean;
  financial: boolean;
}

const LABEL: Record<string, string> = {
  reports: 'Reports', attachments: 'Files', ticket_messages: 'Messages', tenders: 'Tenders',
  bills: 'Bills', audit_logs: 'Audit entries', notifications: 'Queued e-mails',
};

/** Permanent delete. Lists what goes, asks for a reason and the typed ticket number. */
export default function DeleteTicket({ ticketId, onDeleted }: { ticketId: number; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPreview(null); setReason(''); setTyped(''); setForce(false);
    api.get(`/admin/tickets/${ticketId}/delete-preview`)
      .then((r) => setPreview(r.data))
      .catch((e) => { toast.error(errorMessage(e, 'Could not load what would be deleted.')); setOpen(false); });
  }, [open, ticketId]);

  const ref = preview?.ticket_ref ?? '';
  const ready = !!preview && reason.trim().length >= 10 && typed.trim().toUpperCase() === ref && (!preview.financial || force);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      await api.delete(`/admin/tickets/${ticketId}`, { data: { reason: reason.trim(), confirm: typed.trim(), force } });
      toast.success(`${ticketNo(ticketId)} deleted.`);
      setOpen(false);
      onDeleted();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete the ticket.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-rose-200 bg-rose-50/40 p-5 dark:border-rose-900/50 dark:bg-rose-950/10">
      <h3 className="flex items-center gap-2 text-sm font-bold text-rose-700 dark:text-rose-400"><Trash2 size={15} /> Delete ticket</h3>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
        Permanently removes the ticket and everything attached to it. A record that it existed, who deleted it and why is kept.
      </p>
      <button type="button" onClick={() => setOpen(true)}
        className="mt-3 rounded-xl border border-rose-300 px-4 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950/40">
        Delete this ticket…
      </button>

      {open && (
        <div role="dialog" aria-label="Delete ticket" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <form onSubmit={submit} className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-xs shadow-xl dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-700">
              <h4 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
                <Trash2 className="text-rose-600" size={18} /> Delete {ticketNo(ticketId)}
              </h4>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="p-1 text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>

            {!preview ? (
              <div className="flex justify-center py-6"><Loader2 className="animate-spin text-slate-400" /></div>
            ) : (
              <>
                <div>
                  <p className="mb-1.5 font-bold text-slate-700 dark:text-slate-300">This will be removed</p>
                  <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-600 dark:text-slate-300">
                    {Object.entries(preview.counts).map(([k, n]) => (
                      <li key={k} className="flex justify-between"><span>{LABEL[k] ?? k}</span><span className="font-mono font-bold">{n}</span></li>
                    ))}
                  </ul>
                </div>

                {preview.financial && (
                  <label className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    <TriangleAlert size={16} className="mt-0.5 shrink-0" />
                    <span>
                      This ticket has {preview.has_bills ? 'bills' : ''}{preview.has_bills && preview.has_award ? ' and ' : ''}{preview.has_award ? 'an awarded tender' : ''}.
                      <span className="mt-1 flex items-center gap-2 font-bold">
                        <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> I understand the financial records are deleted too
                      </span>
                    </span>
                  </label>
                )}

                <div>
                  <label htmlFor="del-reason" className="mb-1 block font-bold text-slate-700 dark:text-slate-300">Reason (at least 10 characters) *</label>
                  <textarea id="del-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
                </div>
                <div>
                  <label htmlFor="del-confirm" className="mb-1 block font-bold text-slate-700 dark:text-slate-300">
                    Type <span className="font-mono">{ref}</span> to confirm *
                  </label>
                  <input id="del-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-700">
              <button type="button" onClick={() => setOpen(false)} className="rounded-xl px-4 py-2 font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700">Cancel</button>
              <button type="submit" disabled={!ready || busy}
                className="flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 font-bold text-white transition hover:bg-rose-700 disabled:opacity-40">
                {busy && <Loader2 size={14} className="animate-spin" />} Delete permanently
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
