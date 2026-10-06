// X2: the one frontend list of ticket statuses. A backend test
// (test/unit/status-parity.test.mjs) fails when this list and
// config/workflow.js drift apart. Presentation only: who may do what comes
// from the API payload.

export const ALL_STATUSES = [
  'UNASSIGNED',
  'ASSIGNED_TO_JE',
  'PENDING_AE_APPROVAL',
  'PENDING_SE_APPROVAL',
  'PENDING_DEAN_APPROVAL',
  'PENDING_DIRECTOR_APPROVAL',
  'APPROVED_FOR_TENDERING',
  'TENDER_PUBLISHED',
  'TECHNICAL_EVALUATION',
  'FINANCIAL_EVALUATION',
  'TENDER_CANCELLED',
  'WORK_IN_PROGRESS',
  'WORK_COMPLETED',
  'RETURNED_TO_JE',
  'DENIED',
  'CLOSED',
] as const;
export type TicketStatus = (typeof ALL_STATUSES)[number];

// Same groups as config/workflow.js.
export const JE_STAGE: readonly string[] = ['ASSIGNED_TO_JE', 'RETURNED_TO_JE'];
export const APPROVAL_STAGE: readonly string[] = [
  'PENDING_AE_APPROVAL', 'PENDING_SE_APPROVAL', 'PENDING_DEAN_APPROVAL', 'PENDING_DIRECTOR_APPROVAL',
];
export const TENDER_STAGE: readonly string[] = [
  'APPROVED_FOR_TENDERING', 'TENDER_PUBLISHED', 'TECHNICAL_EVALUATION', 'FINANCIAL_EVALUATION', 'TENDER_CANCELLED',
];
export const IN_WORK: readonly string[] = ['WORK_IN_PROGRESS', 'WORK_COMPLETED'];
/** Approved tickets, including the finished ones. */
export const POST_APPROVAL: readonly string[] = [...TENDER_STAGE, ...IN_WORK, 'CLOSED'];
export const TERMINAL: readonly string[] = ['CLOSED', 'DENIED'];

export const inGroup = (group: readonly string[], status: string) => group.includes(status);

// ---- labels ---------------------------------------------------------------------------------
// WORK_IN_PROGRESS and WORK_COMPLETED keep their stored names; they read "Awarded" and "Resolved".

const STAFF_STATUS: Record<string, string> = {
  UNASSIGNED: 'Unassigned',
  ASSIGNED_TO_JE: 'With JE for inspection',
  RETURNED_TO_JE: 'Changes requested — with JE',
  PENDING_AE_APPROVAL: 'Waiting for AE',
  PENDING_SE_APPROVAL: 'Waiting for SE',
  PENDING_DEAN_APPROVAL: 'Waiting for Dean',
  PENDING_DIRECTOR_APPROVAL: 'Waiting for Director',
  APPROVED_FOR_TENDERING: 'Approved',
  TENDER_PUBLISHED: 'Tender published',
  TECHNICAL_EVALUATION: 'Technical evaluation',
  FINANCIAL_EVALUATION: 'Financial evaluation',
  TENDER_CANCELLED: 'Tender cancelled',
  WORK_IN_PROGRESS: 'Awarded',
  WORK_COMPLETED: 'Resolved',
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
  TENDER_CANCELLED: 'Approved — tendering',
  WORK_IN_PROGRESS: 'Work in progress',
  WORK_COMPLETED: 'Resolved — please verify',
  CLOSED: 'Completed',
  DENIED: 'Rejected',
};
export const applicantStage = (status: string, stageLabel?: string) =>
  stageLabel || APPLICANT_STAGE[status] || 'In progress';

/** Stages on the applicant's progress bar, in order (the labels above). */
export const APPLICANT_STEPS = [
  'Received', 'Under JE inspection', 'Under review', 'Approved — tendering',
  'Work in progress', 'Resolved — please verify', 'Completed',
] as const;
