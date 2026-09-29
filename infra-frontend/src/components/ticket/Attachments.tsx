import { useEffect, useState } from 'react';
import { FileText, Loader2, ImageOff, X, Download } from 'lucide-react';
import { api } from '../../services/api';
import { toast } from '../../store/toastStore';
import { isImageFile } from '../../lib/ticketUi';

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
      toast.error('Could not download this file. It may no longer be available to you.');
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
