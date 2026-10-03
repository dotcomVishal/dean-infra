import { FileText } from 'lucide-react';
import type { TicketDetail } from './types';
import { Card } from './Card';
import { inr } from '../../lib/ticketUi';
import { format } from 'date-fns';

/** Tender and award. The API sends empty arrays to anyone who may not see them. */
export default function PostApproval({ ticket }: { ticket: TicketDetail }) {
  const tenders = ticket.tenders ?? [];
  if (tenders.length === 0) return null;

  return (
    <>
      {tenders.length > 0 && (
        <Card title="Tender" icon={<FileText size={14} />}>
          <div className="space-y-2">
            {tenders.map((tn) => (
              <div key={tn.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-900/50">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-mono font-bold text-slate-900 dark:text-white">{tn.nit_number ? `NIT ${tn.nit_number}` : 'Tender'}</span>
                  <span className="text-slate-500">{tn.portal_type}</span>
                </div>
                {tn.tender_created_date && (
                  <p className="mt-1 text-slate-600 dark:text-slate-300">
                    Open {format(new Date(tn.tender_created_date), 'd MMM yyyy')} to {tn.tender_end_date ? format(new Date(tn.tender_end_date), 'd MMM yyyy') : '?'}
                  </p>
                )}
                {tn.technical_eval_at && <p className="mt-1 text-slate-600 dark:text-slate-300">Technical evaluation: {format(new Date(tn.technical_eval_at), 'd MMM yyyy, HH:mm')}</p>}
                {tn.financial_eval_at && <p className="mt-1 text-slate-600 dark:text-slate-300">Financial evaluation: {format(new Date(tn.financial_eval_at), 'd MMM yyyy, HH:mm')}</p>}
                {tn.awarded_agency && (
                  <div className="mt-1 flex flex-wrap justify-between gap-2 text-slate-700 dark:text-slate-300">
                    <span>Agency: <strong>{tn.awarded_agency}</strong></span>
                    {tn.award_amount != null && <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">Awarded {inr(tn.award_amount)}</span>}
                  </div>
                )}
                {tn.status === 'CANCELLED' && <p className="mt-1 font-semibold text-rose-600">Cancelled{tn.cancel_reason ? `: ${tn.cancel_reason}` : ''}</p>}
                {tn.remarks && <p className="mt-1 italic text-slate-500">{tn.remarks}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
