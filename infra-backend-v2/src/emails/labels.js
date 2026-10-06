// Words the mails use for desks, stages and money. Stage labels are copied from
// STAFF_STATUS in infra-frontend/src/lib/statuses.ts; test/unit/status-parity.test.mjs keeps them equal.
const DESK = Object.freeze({ JE: 'JE', AE: 'AE', SE: 'SE', DEAN: 'Dean', DIRECTOR: 'Director' });
export const deskName = (desk) => DESK[desk] ?? String(desk ?? '');

export const STAFF_STATUS = Object.freeze({
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
});
export const stageLabel = (status) => STAFF_STATUS[status] ?? String(status ?? '').replace(/_/g, ' ');

/** Indian grouping: 125000 -> ₹1,25,000 */
export const inr = (n) => (n == null || Number.isNaN(Number(n))
  ? ''
  : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

/** NORTH -> North. A campus of null or BOTH reads as the value, or nothing. */
export const campusLabel = (campus) => (campus ? `${String(campus)[0]}${String(campus).slice(1).toLowerCase()}` : '');
