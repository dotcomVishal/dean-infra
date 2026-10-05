import { format } from 'date-fns';
import { FileText, IndianRupee } from 'lucide-react';
import type { TicketDetail } from './types';
import { Card } from './Card';
import { inr } from '../../lib/ticketUi';

const TENDER_LABEL: Record<string, string> = {
  PUBLISHED: 'Published', EVALUATION: 'Evaluation', TECHNICAL_EVALUATION: 'Technical evaluation',
  FINANCIAL_EVALUATION: 'Financial evaluation', AWARDED: 'Awarded', CANCELLED: 'Cancelled',
};
const BILL_TYPE: Record<string, string> = { RA_BILL: 'Running bill', FINAL_BILL: 'Final bill', ADVANCE: 'Advance', SECURITY_REFUND: 'Security refund' };
const PAYMENT: Record<string, string> = { PENDING: 'Pending', DISBURSED: 'Paid' };

const fmtDate = (d?: string | null) => (d ? format(new Date(d), 'd MMM yyyy') : '—');

/** Tender, award and bills. The API sends empty arrays to anyone who may not see them. */
export default function PostApproval({ ticket }: { ticket: TicketDetail }) {
  const tenders = ticket.tenders ?? [];
  const bills = ticket.bills ?? [];
  if (tenders.length === 0 && bills.length === 0) return null;
  const disbursed = bills.reduce((n, b) => (b.payment_status === 'DISBURSED' ? n + Number(b.net_amount) : n), 0);

  return (
    <>
      {tenders.length > 0 && (
        <Card title="Tender" icon={<FileText size={14} />}>
          <div className="space-y-2">
            {tenders.map((tn) => (
              <div key={tn.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-900/50">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-bold text-slate-900 dark:text-white">{TENDER_LABEL[tn.status ?? ''] ?? 'Tender'}</span>
                  {tn.nit_number && (
                    <span className="font-mono text-slate-500">NIT {tn.nit_number}{tn.portal_type ? ` · ${tn.portal_type}` : ''}</span>
                  )}
                </div>
                {(tn.published_date || tn.bid_end_date) && (
                  <p className="mt-1 text-slate-600 dark:text-slate-300">
                    Created {fmtDate(tn.published_date)} · End {fmtDate(tn.bid_end_date)}
                  </p>
                )}
                {tn.cancel_reason && <p className="mt-1 text-rose-600 dark:text-rose-400">Cancelled: {tn.cancel_reason}</p>}
                {(tn.awarded_agency || tn.work_order_value != null) && (
                  <div className="mt-1 flex flex-wrap justify-between gap-2 text-slate-700 dark:text-slate-300">
                    {tn.awarded_agency && <span>Agency: <strong>{tn.awarded_agency}</strong></span>}
                    {tn.work_order_value != null && <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">Final {inr(tn.work_order_value)}</span>}
                  </div>
                )}
                {tn.remarks && <p className="mt-1 italic text-slate-500">{tn.remarks}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}
      {bills.length > 0 && (
        <Card
          title="Bills"
          icon={<IndianRupee size={14} />}
          right={<span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">Disbursed {inr(disbursed)}</span>}
        >
          <div className="space-y-2">
            {bills.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-900/50">
                <div className="min-w-0">
                  <p className="font-mono font-bold text-slate-900 dark:text-white">
                    {b.bill_number} <span className="font-sans font-normal text-slate-400">({BILL_TYPE[b.bill_type] ?? b.bill_type})</span>
                  </p>
                  <p className="truncate text-slate-500">{b.agency_name}{b.voucher_number ? ` · Voucher ${b.voucher_number}` : ''}</p>
                  <span className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                    b.payment_status === 'DISBURSED' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>
                    {PAYMENT[b.payment_status] ?? b.payment_status}
                  </span>
                </div>
                <span className="shrink-0 font-mono font-bold text-slate-900 dark:text-white">{inr(b.net_amount)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
