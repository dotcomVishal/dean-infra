import { useEffect, useRef, useState } from 'react';
import { FileText, Loader2, ImageOff, X, Download, Upload } from 'lucide-react';
import { api } from '../../services/api';
import { toast } from '../../store/toastStore';
import { format } from 'date-fns';
import { isImageFile, errorMessage, deskLabel } from '../../lib/ticketUi';
import { cachedObjectUrl } from '../../lib/blobCache';
import { checkFiles, loadUploadLimits, type UploadLimits } from '../../lib/uploadLimits';
import { shrinkAll } from '../../lib/shrinkImage';

// Files are never addressed by path (S2): the API hands out an authenticated
// /api/attachments/:id URL, and <img src> cannot send a bearer token, so every
// file is fetched through the axios client and shown from a blob URL.

export interface Attachment {
  id: number;
  document_category?: string | null;
  created_at: string;
  file_name: string;
  download_url: string;
  report_id?: number;
  /** Desk the uploader acted as, recorded at upload time. Staff payload only. */
  uploader_desk?: string | null;
  /** Null for a JE looking at a higher desk's file (desk only, never the name). */
  uploader_name?: string | null;
  audit_log_id?: number;
  /** The movement the file travelled with. */
  attached_with?: { action: string | null; from_desk: string | null; to_desk: string | null };
}

// axios already prefixes its baseURL (which ends in /api).
const relativeUrl = (downloadUrl: string) => downloadUrl.replace(/^\/api(?=\/)/, '');

async function fetchBlob(downloadUrl: string): Promise<Blob> {
  const res = await api.get(relativeUrl(downloadUrl), { responseType: 'blob' });
  return res.data as Blob;
}

const cachedBlobUrl = (downloadUrl: string) => cachedObjectUrl(downloadUrl, () => fetchBlob(downloadUrl));

// Fetch only when the thumbnail scrolls into view, so a ticket with many photos
// does not download them all at once.
function useBlobUrl(downloadUrl: string) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setVisible(true);
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setVisible(true); io.disconnect(); }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setUrl(null);
    setFailed(false);
    cachedBlobUrl(downloadUrl)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [downloadUrl, visible]);

  return { url, failed, ref };
}

export function PhotoThumb({ file, dark = false }: { file: Attachment; dark?: boolean }) {
  const { url, failed, ref } = useBlobUrl(file.download_url);
  const [open, setOpen] = useState(false);
  const box = dark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900';

  if (failed) {
    return (
      <div className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border text-[10px] text-slate-400 ${box}`}>
        <ImageOff size={18} /> Unavailable
      </div>
    );
  }
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => url && setOpen(true)}
        className={`relative aspect-square overflow-hidden rounded-xl border transition hover:opacity-85 ${box}`}
        aria-label={`Open photo ${file.file_name}`}
      >
        {url ? (
          <img src={url} alt={file.file_name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-slate-400">
            <Loader2 size={18} className="animate-spin" />
          </span>
        )}
      </button>
      {open && url && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/90 p-3"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-label="Photo preview"
        >
          <button
            type="button"
            className="absolute right-3 top-[calc(env(safe-area-inset-top,0px)+0.75rem)] rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={() => setOpen(false)}
            aria-label="Close preview"
          >
            <X size={20} />
          </button>
          <img src={url} alt={file.file_name} className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </>
  );
}

export function DocLink({ file, dark = false }: { file: Attachment; dark?: boolean }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const blob = await fetchBlob(file.download_url);
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = file.file_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch {
      toast.error('Could not download this file.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={download}
      disabled={busy}
      className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-semibold transition disabled:opacity-60 ${
        dark
          ? 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-200 dark:hover:bg-slate-700'
      }`}
    >
      <FileText size={14} className="shrink-0 text-emerald-500" />
      <span className="min-w-0 flex-1 truncate">{file.file_name}</span>
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} className="opacity-60" />}
    </button>
  );
}

/** Photos as a grid, everything else as download rows. */
export function AttachmentList({
  files, empty, dark = false, cols = 'grid-cols-3 sm:grid-cols-4',
}: { files: Attachment[]; empty?: string; dark?: boolean; cols?: string }) {
  if (files.length === 0) {
    return empty ? <p className="text-xs text-slate-400">{empty}</p> : null;
  }
  const photos = files.filter((f) => isImageFile(f.file_name));
  const docs = files.filter((f) => !isImageFile(f.file_name));
  return (
    <div className="space-y-2">
      {photos.length > 0 && (
        <div className={`grid gap-2 ${cols}`}>
          {photos.map((f) => <PhotoThumb key={f.id} file={f} dark={dark} />)}
        </div>
      )}
      {docs.length > 0 && (
        <div className="space-y-1.5">
          {docs.map((f) => <DocLink key={f.id} file={f} dark={dark} />)}
        </div>
      )}
    </div>
  );
}

// Desk order for the Documents card, and what an older row (no uploader_desk) falls back to.
const DESK_GROUPS = ['APPLICANT', 'JE', 'AE', 'SE', 'DEAN', 'DIRECTOR', 'CLERICAL', 'ACCOUNTANT', 'SYSADMIN'];
const CATEGORY_DESK: Record<string, string> = {
  APPLICANT_EVIDENCE: 'APPLICANT', JE_SITE_PHOTO: 'JE', JE_ESTIMATE_DOC: 'JE', WORK_DOC: 'JE',
  CLERK_TENDER_DOC: 'CLERICAL', FINANCE_SANCTION: 'ACCOUNTANT',
};
const deskOf = (f: Attachment) => f.uploader_desk ?? CATEGORY_DESK[f.document_category ?? ''] ?? 'OTHER';

const MOVEMENT_TEXT: Record<string, (to: string | null) => string> = {
  FORWARDED: (to) => `forwarded${to ? ` to ${deskLabel(to)}` : ''}`,
  CHANGES_REQUESTED: (to) => `sent back${to ? ` to ${deskLabel(to)}` : ''}`,
  APPROVED: () => 'approved',
  REJECTED: () => 'rejected',
  SUBMITTED: () => 'report filed',
  ASSIGNED: () => 'assigned',
};
const movementCaption = (f: Attachment) => {
  const w = f.attached_with;
  const when = format(new Date(f.created_at), 'd MMM HH:mm');
  const text = w?.action ? (MOVEMENT_TEXT[w.action]?.(w.to_desk) ?? w.action.toLowerCase().replace(/_/g, ' ')) : null;
  return text ? `${text}, ${when}` : when;
};

/** Files grouped by the desk that attached them, in desk order, each batch captioned with its movement. */
export function GroupedAttachments({ files, empty }: { files: Attachment[]; empty?: string }) {
  if (files.length === 0) return empty ? <p className="text-xs text-slate-400">{empty}</p> : null;
  const groups = new Map<string, Attachment[]>();
  for (const f of files) groups.set(deskOf(f), [...(groups.get(deskOf(f)) ?? []), f]);
  const order = [...groups.keys()].sort((a, b) => {
    const ia = DESK_GROUPS.indexOf(a); const ib = DESK_GROUPS.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return (
    <div className="space-y-3">
      {order.map((desk) => {
        const list = groups.get(desk)!;
        const names = [...new Set(list.map((f) => f.uploader_name).filter(Boolean))];
        // One batch per movement (or per upload day when a file travelled with none).
        const batches = new Map<string, Attachment[]>();
        for (const f of list) {
          const k = f.audit_log_id != null ? `m${f.audit_log_id}` : `d${f.created_at.slice(0, 16)}`;
          batches.set(k, [...(batches.get(k) ?? []), f]);
        }
        return (
          <div key={desk}>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {desk === 'OTHER' ? 'Other' : deskLabel(desk)}{names.length > 0 ? ` · ${names.join(', ')}` : ''}
            </p>
            <div className="space-y-2">
              {[...batches.values()].map((batch) => (
                <div key={batch[0].id}>
                  <p className="mb-1 text-[10px] text-slate-400">{movementCaption(batch[0])}</p>
                  <AttachmentList files={batch} cols="grid-cols-3" />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Add files to a ticket. POST /tickets/:id/attachments; the server decides who may read them. */
export function UploadFiles({ ticketId, onDone, label = 'Add files' }: { ticketId: number; onDone: () => void; label?: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const [limits, setLimits] = useState<UploadLimits | null>(null);
  useEffect(() => { loadUploadLimits().then(setLimits); }, []);

  const send = async () => {
    if (files.length === 0) return;
    const tooBig = limits && checkFiles(files, limits);
    if (tooBig) { toast.error(tooBig); return; }
    setBusy(true);
    const fd = new FormData();
    for (const f of await shrinkAll(files)) fd.append('files', f);
    try {
      await api.post(`/tickets/${ticketId}/attachments`, fd);
      toast.success(`${files.length} file${files.length > 1 ? 's' : ''} uploaded.`);
      setFiles([]);
      setInputKey((k) => k + 1);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, 'Upload failed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input
        key={inputKey}
        type="file"
        multiple
        accept=".jpg,.jpeg,.png,.webp,.heic,.pdf,.xlsx,.docx"
        onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, limits?.attachment_files ?? 10))}
        aria-label={label}
        className="min-w-0 flex-1 text-xs text-slate-600 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-semibold dark:text-slate-300 dark:file:bg-slate-700 dark:file:text-slate-200"
      />
      <button
        type="button"
        onClick={send}
        disabled={busy || files.length === 0}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {label}
      </button>
    </div>
  );
}
