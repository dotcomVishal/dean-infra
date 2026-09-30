// Shared, presentation-only helpers. Nothing here decides who may do what:
// permissions and limits always come from the API payload.

export const ticketNo = (id: number | string) => `#TKT-${String(id).padStart(4, '0')}`;

export const inr = (n: number | string | null | undefined) =>
  n == null || n === '' || Number.isNaN(Number(n)) ? '—' : `₹${Number(n).toLocaleString('en-IN')}`;

/** Pulls the server's message out of an axios error. */
export const errorMessage = (err: unknown, fallback: string): string => {
  const e = err as { response?: { data?: { message?: string } } };
  return e?.response?.data?.message || fallback;
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

const STAFF_STATUS: Record<string, string> = {
  UNASSIGNED: 'Unassigned — waiting for AE to choose a JE',
  ASSIGNED_TO_JE: 'With JE for inspection',
  RETURNED_TO_JE: 'Changes requested — with JE',
  PENDING_AE_APPROVAL: 'Waiting for AE',
  PENDING_SE_APPROVAL: 'Waiting for SE',
  PENDING_DEAN_APPROVAL: 'Waiting for Dean',
  PENDING_DIRECTOR_APPROVAL: 'Waiting for Director',
  APPROVED_FOR_TENDERING: 'Approved — awaiting tender',
  TENDER_PUBLISHED: 'Tender published',
  WORK_IN_PROGRESS: 'Work in progress',
  WORK_COMPLETED: 'Work done — awaiting applicant confirmation',
  CLOSED: 'Closed',
  DENIED: 'Rejected',
};
export const staffStatusLabel = (status: string) => STAFF_STATUS[status] ?? status.replace(/_/g, ' ');

// Plain-words stage for the applicant. The API sends `stage_label`; this is
// only the fallback if an older payload lacks it. Never names a person.
const APPLICANT_STAGE: Record<string, string> = {
  UNASSIGNED: 'Received',
  ASSIGNED_TO_JE: 'Under JE inspection',
  RETURNED_TO_JE: 'Under JE inspection',
  PENDING_AE_APPROVAL: 'Under review',
  PENDING_SE_APPROVAL: 'Under review',
  PENDING_DEAN_APPROVAL: 'Under review',
  PENDING_DIRECTOR_APPROVAL: 'Under review',
  APPROVED_FOR_TENDERING: 'Approved — tendering',
  TENDER_PUBLISHED: 'Approved — tendering',
  WORK_IN_PROGRESS: 'Work in progress',
  WORK_COMPLETED: 'Work done — please verify',
  CLOSED: 'Completed',
  DENIED: 'Rejected',
};
export const applicantStage = (status: string, stageLabel?: string) =>
  stageLabel || APPLICANT_STAGE[status] || 'In progress';

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

export const isPostApproval = (status: string) =>
  ['APPROVED_FOR_TENDERING', 'TENDER_PUBLISHED', 'WORK_IN_PROGRESS', 'WORK_COMPLETED', 'CLOSED'].includes(status);

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
