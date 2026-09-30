import { FileText, IndianRupee } from 'lucide-react';
import type { TicketDetail } from './types';
import { Card } from './Card';
import { inr } from '../../lib/ticketUi';

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
                  <span className="font-mono font-bold text-slate-900 dark:text-white">NIT {tn.nit_number}</span>
                  <span className="text-slate-500">{tn.portal_type}</span>
                </div>
                {tn.awarded_agency && (
                  <div className="mt-1 flex flex-wrap justify-between gap-2 text-slate-700 dark:text-slate-300">
                    <span>Agency: <strong>{tn.awarded_agency}</strong></span>
                    {tn.work_order_value != null && <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">Work order {inr(tn.work_order_value)}</span>}
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
                    {b.bill_number} <span className="font-sans font-normal text-slate-400">({b.bill_type})</span>
                  </p>
                  <p className="truncate text-slate-500">{b.agency_name}{b.voucher_number ? ` · Voucher ${b.voucher_number}` : ''}</p>
                  <span className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                    b.payment_status === 'DISBURSED' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>
                    {b.payment_status}
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
