import { useEffect, useState } from 'react';
import { FileText, Loader2, ImageOff, X, Download, Upload } from 'lucide-react';
import { api } from '../../services/api';
import { toast } from '../../store/toastStore';
import { isImageFile, errorMessage } from '../../lib/ticketUi';

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
}

// axios already prefixes its baseURL (which ends in /api).
const relativeUrl = (downloadUrl: string) => downloadUrl.replace(/^\/api(?=\/)/, '');

async function fetchBlob(downloadUrl: string): Promise<Blob> {
  const res = await api.get(relativeUrl(downloadUrl), { responseType: 'blob' });
  return res.data as Blob;
}

function useBlobUrl(downloadUrl: string) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    fetchBlob(downloadUrl)
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [downloadUrl]);

  return { url, failed };
}

export function PhotoThumb({ file, dark = false }: { file: Attachment; dark?: boolean }) {
  const { url, failed } = useBlobUrl(file.download_url);
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

// Who uploaded what, in words. The server picks the category from the uploader.
const CATEGORY_LABEL: Record<string, string> = {
  APPLICANT_EVIDENCE: 'Applicant', JE_SITE_PHOTO: 'JE site photo', JE_ESTIMATE_DOC: 'JE estimate',
  WORK_DOC: 'JE work / completion', DESK_DOC: 'Approving officer', CLERK_TENDER_DOC: 'Tender (Clerical)',
  FINANCE_SANCTION: 'Finance', AUTHORITY_REMARKS: 'Authority',
};

/** Files grouped by who uploaded them. */
export function GroupedAttachments({ files, empty }: { files: Attachment[]; empty?: string }) {
  if (files.length === 0) return empty ? <p className="text-xs text-slate-400">{empty}</p> : null;
  const groups = new Map<string, Attachment[]>();
  for (const f of files) {
    const k = f.document_category ?? 'APPLICANT_EVIDENCE';
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  return (
    <div className="space-y-3">
      {[...groups].map(([k, list]) => (
        <div key={k}>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{CATEGORY_LABEL[k] ?? k}</p>
          <AttachmentList files={list} cols="grid-cols-3" />
        </div>
      ))}
    </div>
  );
}

/** Add files to a ticket. POST /tickets/:id/attachments; the server decides who may read them. */
export function UploadFiles({ ticketId, onDone, label = 'Add files' }: { ticketId: number; onDone: () => void; label?: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  const send = async () => {
    if (files.length === 0) return;
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    setBusy(true);
    try {
      await api.post(`/tickets/${ticketId}/attachments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
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
        onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 10))}
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
