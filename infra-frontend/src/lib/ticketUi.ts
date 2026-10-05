// Shared, presentation-only helpers. Nothing here decides who may do what:
// permissions and limits always come from the API payload.

import { POST_APPROVAL } from './statuses';

export const ticketNo = (id: number | string) => `#TKT-${String(id).padStart(4, '0')}`;

export const inr = (n: number | string | null | undefined) =>
  n == null || n === '' || Number.isNaN(Number(n)) ? '—' : `₹${Number(n).toLocaleString('en-IN')}`;

// Statuses whose server text is written for the user. Anything else
// (401/403/5xx) is replaced here, so one place decides what a user reads.
const USER_TEXT_STATUS = new Set([400, 409, 413, 415, 429]);
const STATUS_MESSAGE: Record<number, string> = {
  413: 'Files are too large. Remove some files or use smaller ones.',
  415: 'One of the files is not an allowed type.',
  429: 'Too many requests. Wait a minute and try again.',
};

/** Turns an axios error into text for a toast. Empty string means show nothing (401: the interceptor already toasts). */
export const errorMessage = (err: unknown, fallback: string): string => {
  const res = (err as { response?: { status?: number; data?: { message?: string } } })?.response;
  if (!res) return 'No connection. Check your network and try again.';
  const status = res.status ?? 0;
  if (status === 401) return '';
  if (status === 403) return 'You do not have access to this.';
  if (USER_TEXT_STATUS.has(status)) return res.data?.message || STATUS_MESSAGE[status] || fallback;
  return fallback;
};

export const DESK_ORDER = ['JE', 'AE', 'SE', 'DEAN', 'DIRECTOR'] as const;
export type Desk = (typeof DESK_ORDER)[number];
export const DESK_RANK: Record<string, number> = { JE: 1, AE: 2, SE: 3, DEAN: 4, DIRECTOR: 5 };
export const DESK_LABEL: Record<string, string> = {
  JE: 'JE', AE: 'AE', SE: 'SE', DEAN: 'Dean', DIRECTOR: 'Director',
  CLERICAL: 'Clerical', ACCOUNTANT: 'Accountant', SYSADMIN: 'Sysadmin', APPLICANT: 'Applicant',
};
export const deskLabel = (d?: string | null) => (d ? DESK_LABEL[d] ?? d : '');

/** Desks that can read a message stamped with this visible_from_rank (rank compare, plan §3.6). */
export const visibleDesks = (fromRank: number): string[] =>
  DESK_ORDER.filter((d) => DESK_RANK[d] >= fromRank).map(deskLabel);

// Current holder of a ticket, by status. Presentation only.
export const STATUS_DESK: Record<string, string> = {
  UNASSIGNED: 'AE',
  ASSIGNED_TO_JE: 'JE',
  RETURNED_TO_JE: 'JE',
  PENDING_AE_APPROVAL: 'AE',
  PENDING_SE_APPROVAL: 'SE',
  PENDING_DEAN_APPROVAL: 'DEAN',
  PENDING_DIRECTOR_APPROVAL: 'DIRECTOR',
};

export { staffStatusLabel, applicantStage } from './statuses';

// ---- SLA ageing -----------------------------------------------------------
export type Sla = 'ok' | 'warn' | 'late';
const WARN_AFTER_HOURS = 24;
const LATE_AFTER_HOURS = 72;

export const hoursSince = (iso: string | Date | null | undefined, now = Date.now()) =>
  iso ? Math.max(0, (now - new Date(iso).getTime()) / 36e5) : 0;

export const slaOf = (hours: number): Sla =>
  hours >= LATE_AFTER_HOURS ? 'late' : hours >= WARN_AFTER_HOURS ? 'warn' : 'ok';

export const SLA_CLASS: Record<Sla, { chip: string; bar: string; text: string }> = {
  ok: {
    chip: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
    bar: 'bg-emerald-500', text: 'On track',
  },
  warn: {
    chip: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
    bar: 'bg-amber-500', text: 'Ageing',
  },
  late: {
    chip: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800',
    bar: 'bg-rose-500', text: 'Overdue',
  },
};

/** 5h → "5h", 30h → "1d 6h", 200h → "8d 8h" */
export const formatAge = (hours: number) => {
  if (hours < 1) return '<1h';
  if (hours < 24) return `${Math.floor(hours)}h`;
  const d = Math.floor(hours / 24);
  const h = Math.floor(hours % 24);
  return h ? `${d}d ${h}h` : `${d}d`;
};

export const isPostApproval = (status: string) => POST_APPROVAL.includes(status);

/** "North · near A1 gate". Tickets raised before the form change may carry a building and a combined location; they still read correctly. */
export const placeLabel = (t: { campus?: string | null; building?: string | null; landmark?: string | null; location?: string | null }) =>
  (t.landmark
    ? [t.campus, t.building, t.landmark]
    : [t.campus, t.location]
  ).filter(Boolean).join(' · ') || 'Campus';

export const mapsHref = (t: { lat?: number | string | null; lng?: number | string | null; location?: string }) => {
  let q = encodeURIComponent(t.location || '');
  if (t.lat != null && t.lng != null && t.lat !== '' && t.lng !== '') q = `${t.lat},${t.lng}`;
  else {
    const m = (t.location || '').match(/Lat:\s*([0-9.-]+),\s*Lng:\s*([0-9.-]+)/);
    if (m) q = `${m[1]},${m[2]}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
};

export const isImageFile = (name: string) => /\.(jpe?g|png|webp|gif|heic)$/i.test(name);
