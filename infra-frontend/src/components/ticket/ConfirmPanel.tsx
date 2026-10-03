import { useState } from 'react';
import { format } from 'date-fns';
import { CheckCircle2, Loader2, Wrench, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { toast } from '../../store/toastStore';
import { Card } from './Card';
import { errorMessage } from '../../lib/ticketUi';
import type { Confirmation } from './types';

/**
 * For the person the server names as the confirmer of a resolved ticket: the one who raised it, or the AE when
 * the JE raised it. Shown on the staff page as well as the applicant page. A cancelled tender offers one
 * button, "Acknowledge and close". Nothing here decides who may answer: the panel exists only when the API
 * sent `confirmation`.
 */
export default function ConfirmPanel({ ticketId, confirmation, onDone }: {
  ticketId: number; confirmation: Confirmation; onDone: () => void;
}) {
  const [sendingBack, setSendingBack] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const cancelled = confirmation.resolution_kind === 'TENDER_CANCELLED';

  const answer = async (accepted: boolean) => {
    setBusy(true);
    try {
      const res = await api.post(`/tickets/${ticketId}/confirm-completion`, { accepted, remarks: remarks.trim() || undefined });
      toast.success(res.data.message);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not send your answer.'));
    } finally {
      setBusy(false);
    }
  };

  const closeBy = confirmation.auto_close_at ? format(new Date(confirmation.auto_close_at), 'd MMM yyyy') : null;
  return (
    <Card title={cancelled ? 'Tender cancelled' : 'Is it resolved?'} icon={<Wrench size={14} />}>
      <p className="text-sm text-slate-700 dark:text-slate-200">
        {cancelled
          ? 'The tender was cancelled and the ticket resolved. Acknowledge to close it; raise a new ticket for a new tender.'
          : 'The engineer has marked this resolved. Please check, then close the ticket or send it back with a comment.'}
        {closeBy && <> If nobody answers, it closes by itself on {closeBy}.</>}
      </p>
      {sendingBack && (
        <textarea
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={3}
          placeholder="What is still not done?"
          className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        />
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {!sendingBack ? (
          <>
            <button type="button" disabled={busy} onClick={() => answer(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              {cancelled ? 'Acknowledge and close' : 'Close ticket'}
            </button>
            {confirmation.can_send_back && (
              <button type="button" disabled={busy} onClick={() => setSendingBack(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 px-4 py-2 text-sm font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:hover:bg-rose-950/30">
                <XCircle size={14} /> Send back
              </button>
            )}
            {cancelled && (
              <Link to="/raise" className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-slate-700">
                Raise a new ticket
              </Link>
            )}
          </>
        ) : (
          <>
            <button type="button" disabled={busy || remarks.trim() === ''} onClick={() => answer(false)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50">
              {busy && <Loader2 size={14} className="animate-spin" />} Send back
            </button>
            <button type="button" disabled={busy} onClick={() => setSendingBack(false)}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">
              Cancel
            </button>
          </>
        )}
      </div>
    </Card>
  );
}
