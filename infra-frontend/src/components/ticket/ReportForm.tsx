import { useEffect, useState } from 'react';
import { ClipboardCheck, Image as ImageIcon, Loader2, UploadCloud, X } from 'lucide-react';
import { api } from '../../services/api';
import { toast } from '../../store/toastStore';
import { errorMessage } from '../../lib/ticketUi';
import type { Report, TicketMessage } from './types';

// Must match the API allow-list (middleware/upload.js).
const PHOTO_ACCEPT = '.jpg,.jpeg,.png,.webp,.heic';
const DOC_ACCEPT = '.pdf,.xlsx,.docx';
const inputCls =
  'w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-900 dark:text-white';

/** JE's SUBMIT_REPORT action: findings + estimate. Also answers an open change request. */
export default function ReportForm({ ticketId, previous, request, onDone }: {
  ticketId: number;
  previous?: Report | null;
  request: TicketMessage | null; // open change request addressed to this JE, if any
  onDone: () => void;
}) {
  const [nature, setNature] = useState(previous?.nature_of_work ?? '');
  const [amount, setAmount] = useState(previous ? String(previous.estimated_amount) : '');
  const [remarks, setRemarks] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [docs, setDocs] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Bumped after every pick so the input is empty again: re-picking a file that was just removed still fires onChange.
  const [pickKey, setPickKey] = useState(0);

  useEffect(() => {
    const urls = photos.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [photos]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseFloat(amount);
    if (!nature.trim()) return toast.error('Enter your findings.');
    if (!n || n <= 0) return toast.error('Enter an estimate above 0.');
    if (request && !remarks.trim()) return toast.error('Reply to the request first.');

    const fd = new FormData();
    fd.append('nature_of_work', nature.trim());
    fd.append('estimated_amount', String(n));
    if (remarks.trim()) fd.append('remarks', remarks.trim());
    photos.forEach((f) => fd.append('site_photos', f));
    docs.forEach((f) => fd.append('estimate_docs', f));

    setBusy(true);
    try {
      const res = await api.post(`/tickets/${ticketId}/report`, fd);
      toast.success(res.data?.message || 'Report submitted.');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not submit the report.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Findings <span className="text-rose-500">*</span>
        </label>
        <textarea rows={4} value={nature} onChange={(e) => setNature(e.target.value)} className={`${inputCls} resize-none`}
          placeholder="Work required, materials, quantities" />
      </div>

      <div>
        <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Estimate (₹) <span className="text-rose-500">*</span>
        </label>
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-slate-400">₹</span>
          <input type="number" inputMode="decimal" step="0.01" min="1" value={amount} onChange={(e) => setAmount(e.target.value)}
            className={`${inputCls} pl-9 font-mono font-bold`} placeholder="e.g. 45000" />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
          {request ? <>Reply to {request.author_desk} <span className="text-rose-500">*</span></> : 'Remarks (optional)'}
        </label>
        <textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} className={`${inputCls} resize-none`}
          placeholder={request ? 'What did you change?' : 'Anything the AE should know'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2 rounded-xl border border-dashed border-slate-300 p-3 dark:border-slate-600">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300"><ImageIcon size={14} /> Site photos ({photos.length})</span>
            <label className="cursor-pointer rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-blue-700">
              Add
              <input key={`photo-${pickKey}`} type="file" multiple accept={PHOTO_ACCEPT} className="hidden"
                onChange={(e) => { const picked = Array.from(e.target.files ?? []); setPhotos((p) => [...p, ...picked].slice(0, 10)); setPickKey((k) => k + 1); }} />
            </label>
          </div>
          {previews.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {previews.map((u, i) => (
                <div key={u} className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                  <img src={u} alt="" className="h-full w-full object-cover" />
                  <button type="button" aria-label="Remove photo" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}
                    className="absolute right-1 top-1 rounded-full bg-slate-900/70 p-0.5 text-white hover:bg-rose-600"><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2 rounded-xl border border-dashed border-slate-300 p-3 dark:border-slate-600">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300"><UploadCloud size={14} /> Documents ({docs.length})</span>
            <label className="cursor-pointer rounded-lg bg-slate-800 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-slate-900 dark:bg-slate-600">
              Add
              <input key={`doc-${pickKey}`} type="file" multiple accept={DOC_ACCEPT} className="hidden"
                onChange={(e) => { const picked = Array.from(e.target.files ?? []); setDocs((p) => [...p, ...picked].slice(0, 10)); setPickKey((k) => k + 1); }} />
            </label>
          </div>
          {docs.map((f, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800">
              <span className="min-w-0 truncate text-slate-700 dark:text-slate-300">{f.name}</span>
              <button type="button" aria-label="Remove document" onClick={() => setDocs((p) => p.filter((_, j) => j !== i))} className="ml-2 text-slate-400 hover:text-rose-600"><X size={13} /></button>
            </div>
          ))}
        </div>
      </div>

      <button type="submit" disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 text-sm font-bold text-white shadow-md transition hover:bg-blue-700 disabled:opacity-60">
        {busy ? <Loader2 size={18} className="animate-spin" /> : <ClipboardCheck size={18} />}
        {request ? 'Resubmit to AE' : 'Submit to AE'}
      </button>
    </form>
  );
}
