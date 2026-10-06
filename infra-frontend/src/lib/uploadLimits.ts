import { api } from '../services/api';

// Served by GET /api/meta/upload-limits so the forms refuse an oversize upload
// on the page, before it fails at the proxy with an unreadable error (R5).
export interface UploadLimits {
  max_file_bytes: number;
  max_request_bytes: number;
  raise_ticket_files: number;
  report_photos: number;
  report_documents: number;
  attachment_files: number;
}

const FALLBACK: UploadLimits = {
  max_file_bytes: 30 * 1024 * 1024,
  max_request_bytes: 90 * 1024 * 1024,
  raise_ticket_files: 5,
  report_photos: 10,
  report_documents: 10,
  attachment_files: 10,
};

let pending: Promise<UploadLimits> | null = null;

export function loadUploadLimits(): Promise<UploadLimits> {
  pending ??= api.get('/meta/upload-limits')
    .then((r) => ({ ...FALLBACK, ...(r.data?.limits ?? {}) }) as UploadLimits)
    .catch(() => { pending = null; return FALLBACK; });
  return pending;
}

const mb = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;

/** Returns a message when the files break a limit, else null. */
export function checkFiles(files: File[], limits: UploadLimits): string | null {
  const big = files.find((f) => f.size > limits.max_file_bytes);
  if (big) return `"${big.name}" is larger than ${mb(limits.max_file_bytes)}.`;
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > limits.max_request_bytes) return `Files together are larger than ${mb(limits.max_request_bytes)}.`;
  return null;
}
