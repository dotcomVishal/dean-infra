// Shared, presentation-only helpers. Nothing here decides who may do what:
// permissions and limits always come from the API payload.

export const ticketNo = (id: number | string) => `#TKT-${String(id).padStart(4, '0')}`;

export const inr = (n: number | string | null | undefined) =>
  n == null || n === '' || Number.isNaN(Number(n)) ? '—' : `₹${Number(n).toLocaleString('en-IN')}`;

/**
 * Message to show for a failed request. The server's own message wins; proxy and network
 * failures have no JSON body, so they are told apart by status. A 5xx carries the request
 * id so support can find the log line.
 */
export const errorMessage = (err: unknown, fallback: string): string => {
  const e = err as { response?: { status?: number; data?: { message?: string; requestId?: string } }; request?: unknown };
  const status = e?.response?.status;
  const data = e?.response?.data;
  if (status && status >= 500) {
    const id = data?.requestId ? ` (ref ${data.requestId.slice(0, 8)})` : '';
    return `${typeof data?.message === 'string' ? data.message : 'Server error'}${id}`;
  }
  if (typeof data?.message === 'string' && data.message) return data.message;
  if (status === 413) return 'Files are too large. Use fewer or smaller files.';
  if (status === 429) return 'Too many requests. Wait a minute and try again.';
  if (!e?.response && e?.request) return 'Network problem. Check your connection and try again.';
  return fallback;
};

export const DESK_ORDER = ['JE', 'AE', 'SE', 'DEAN', 'DIRECTOR'] as const;
export type Desk = (typeof DESK_ORDER)[number];
export const DESK_RANK: Record<string, number> = { JE: 1, AE: 2, SE: 3, DEAN: 4, DIRECTOR: 5 };
export const DESK_LABEL: Record<string, string> = {
  JE: 'JE', AE: 'AE', SE: 'SE', DEAN: 'Dean', DIRECTOR: 'Director',
  SYSADMIN: 'Sysadmin', APPLICANT: 'Applicant',
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
  TECHNICAL_EVALUATION: 'Technical evaluation',
  FINANCIAL_EVALUATION: 'Financial evaluation',
  WORK_IN_PROGRESS: 'Work in progress',
  WORK_COMPLETED: 'Resolved, awaiting confirmation',
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
  TECHNICAL_EVALUATION: 'Approved — tendering',
  FINANCIAL_EVALUATION: 'Approved — tendering',
  WORK_IN_PROGRESS: 'Work in progress',
  WORK_COMPLETED: 'Resolved — please confirm',
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

// One place for the status lists (mirrors config/workflow.js on the server).
/** After the approval chain, in the order a ticket moves through. */
export const POST_APPROVAL_STATUSES = [
  'APPROVED_FOR_TENDERING', 'TENDER_PUBLISHED', 'TECHNICAL_EVALUATION', 'FINANCIAL_EVALUATION',
  'WORK_IN_PROGRESS', 'WORK_COMPLETED', 'CLOSED',
] as const;
/** A tender can be cancelled in any of these. */
export const TENDER_STAGES = ['TENDER_PUBLISHED', 'TECHNICAL_EVALUATION', 'FINANCIAL_EVALUATION'] as const;
/** Every status a ticket can be forced to by the Sysadmin, in journey order. */
export const ALL_STATUSES = [
  'UNASSIGNED', 'ASSIGNED_TO_JE', 'PENDING_AE_APPROVAL', 'PENDING_SE_APPROVAL', 'PENDING_DEAN_APPROVAL',
  'PENDING_DIRECTOR_APPROVAL', 'RETURNED_TO_JE', ...POST_APPROVAL_STATUSES, 'DENIED',
] as const;

export const isPostApproval = (status: string) => (POST_APPROVAL_STATUSES as readonly string[]).includes(status);
/** Still moving: not awaiting confirmation, closed or rejected. */
export const isOpenStatus = (status: string) => !['WORK_COMPLETED', 'CLOSED', 'DENIED'].includes(status);

/** Applicant label for a resolved ticket depends on how it was resolved. */
export const resolvedApplicantLabel = (kind?: string | null) =>
  kind === 'TENDER_CANCELLED' ? 'Tender cancelled — please acknowledge' : 'Resolved — please confirm';

/** Coordinates when the raiser pinned them, else a search on campus and landmark. */
export const mapsHref = (t: { lat?: number | string | null; lng?: number | string | null; campus?: string | null; landmark?: string | null }) => {
  let q = encodeURIComponent([t.landmark, t.campus && `${t.campus} campus`].filter(Boolean).join(', '));
  if (t.lat != null && t.lng != null && t.lat !== '' && t.lng !== '') q = `${t.lat},${t.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
};

export const isImageFile = (name: string) => /\.(jpe?g|png|webp|gif|heic)$/i.test(name);
