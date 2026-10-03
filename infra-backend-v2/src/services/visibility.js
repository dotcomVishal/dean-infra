// ============================================================
//  VISIBILITY ENGINE — the one place that decides who may see what
//  (plan.md §3.6). Used by the ticket details endpoint, the attachment
//  download endpoint, the queues and the email builder.
//
//  Everything here is a pure function of (viewer, ticket, data) except
//  loadViewer(), which gathers the two facts a pure function cannot know (an
//  AE's scopes, whether a JE ever filed a report). Fail closed: an unknown
//  role, category or status gets nothing.
//
//  A person can hold two relations to one ticket: they may have RAISED it
//  (applicant view) and hold a staff role that covers it (staff view). The
//  viewer sees the UNION of the two.
// ============================================================
import { DESK_RANK, STATUS, POST_APPROVAL_STATUSES, canReadMessage } from '../config/workflow.js';

// AUDIT visibility = executive level: SE and above. (Nothing writes it yet.)
const AUTHORITY_MIN_RANK = DESK_RANK.SE;

// ---- stage in plain words (what an applicant may know) -------------------------
const STAGE_LABEL = Object.freeze({
  [STATUS.UNASSIGNED]:                'Received',
  [STATUS.ASSIGNED_TO_JE]:            'Under JE inspection',
  [STATUS.RETURNED_TO_JE]:            'Under JE inspection',
  [STATUS.PENDING_AE_APPROVAL]:       'Under review',
  [STATUS.PENDING_SE_APPROVAL]:       'Under review',
  [STATUS.PENDING_DEAN_APPROVAL]:     'Under review',
  [STATUS.PENDING_DIRECTOR_APPROVAL]: 'Under review',
  [STATUS.APPROVED_FOR_TENDERING]:    'Approved — tendering',
  [STATUS.TENDER_PUBLISHED]:          'Approved — tendering',
  [STATUS.TECHNICAL_EVALUATION]:      'Approved — tendering',
  [STATUS.FINANCIAL_EVALUATION]:      'Approved — tendering',
  [STATUS.WORK_IN_PROGRESS]:          'Work in progress',
  [STATUS.WORK_COMPLETED]:            'Resolved — please confirm',
  [STATUS.CLOSED]:                    'Completed',
  [STATUS.DENIED]:                    'Rejected',
});
export const stageLabel = (status, resolutionKind = null) =>
  status === STATUS.WORK_COMPLETED && resolutionKind === 'TENDER_CANCELLED'
    ? 'Tender cancelled — please acknowledge'
    : STAGE_LABEL[status] ?? 'In progress';

// ---- viewer ---------------------------------------------------------------------

/**
 * @param {{id:number, role:string, department?:string}} user  from the verified token + DB row
 * @param {object} ticket   { applicant_id, assigned_je_id, current_desk_user_id, department, campus, status }
 * @param {{scopes?:Array<{department:string,campus:string}>, filedReport?:boolean}} facts
 */
export function buildViewer(user, ticket, facts = {}) {
  const role = user.role;
  const scopes = facts.scopes ?? [];
  const campusOk = (s) => ticket.campus == null || s.campus === 'BOTH' || s.campus === ticket.campus;
  const aeInScope = role === 'AE' && (
    ticket.current_desk_user_id === user.id
    || ticket.assigned_ae_id === user.id // pinned holder keeps sight after the ticket moves on
    || (scopes.length > 0
      ? scopes.some((s) => s.department === ticket.department && campusOk(s))
      : user.department === ticket.department) // legacy AE with no user_scopes rows
  );
  return {
    id: user.id,
    role,
    // Sysadmin acting as staff on a mock ticket must see what that role sees, not the union with the applicant view.
    isApplicant: ticket.applicant_id === user.id && !(user.isTest && role !== 'APPLICANT'),
    isTest: user.isTest === true,
    isAssignedJe: role === 'JE' && ticket.assigned_je_id === user.id,
    wasJe: role === 'JE' && facts.filedReport === true,
    aeInScope,
  };
}

/** Gathers the facts buildViewer cannot derive from the rows already in hand. */
export async function loadViewer(connection, user, ticket) {
  const facts = {};
  if (user.role === 'AE') {
    const [rows] = await connection.query(
      'SELECT department, campus FROM infra_user_scopes WHERE user_id = ?', [user.id]);
    facts.scopes = rows;
  } else if (user.role === 'JE' && ticket.assigned_je_id !== user.id) {
    const [rows] = await connection.query(
      'SELECT 1 FROM infra_reports WHERE ticket_id = ? AND je_id = ? LIMIT 1', [ticket.id, user.id]);
    facts.filedReport = rows.length > 0;
  }
  return buildViewer(user, ticket, facts);
}

/** The role under which this viewer may see the ticket as STAFF, or null. */
export function staffRole(viewer, ticket) {
  switch (viewer.role) {
    case 'SYSADMIN': case 'SE': case 'DEAN': case 'DIRECTOR':
      return viewer.role;
    case 'JE':
      return viewer.isAssignedJe || viewer.wasJe ? 'JE' : null;
    case 'AE':
      return viewer.aeInScope ? 'AE' : null;
    default:
      return null;
  }
}

export function canViewTicket(viewer, ticket) {
  return viewer.isApplicant || staffRole(viewer, ticket) !== null;
}

/** What each part of the matrix (§3.6) grants this viewer on this ticket. */
export function capabilities(viewer, ticket) {
  const staff = staffRole(viewer, ticket);
  const rank = staff ? (DESK_RANK[staff] ?? 0) : 0;
  return {
    applicantView: viewer.isApplicant,
    staff,
    rank,
    identities: staff !== null,
    applicantContact: staff !== null,
    report: staff !== null,
    tenders: staff !== null,
    reminders: staff === 'SYSADMIN' || rank >= DESK_RANK.AE,
  };
}

// ---- attachments -------------------------------------------------------------------

/**
 * May this viewer download this attachment? Ticket access is checked first, then
 * the category rule. The applicant never gets JE photos or estimate documents.
 * @param {{document_category:string, uploaded_by:number, uploader_role?:string}} att
 */
export function canViewAttachment(viewer, ticket, att) {
  if (!canViewTicket(viewer, ticket)) return false;
  const caps = capabilities(viewer, ticket);
  // Test mode: every upload was made by the one Sysadmin, so "own upload" would bypass the category rules.
  if (att.uploaded_by === viewer.id && !viewer.isTest) return true;
  switch (att.document_category) {
    case 'APPLICANT_EVIDENCE':
      return caps.applicantView || caps.staff !== null;
    case 'JE_SITE_PHOTO':
    case 'JE_ESTIMATE_DOC':
    case 'DESK_DOC': // approval-chain files: flow back down to the JE, never to the applicant
      return caps.staff !== null;
    case 'WORK_DOC': // execution / completion proof: the applicant verifies against it
      return caps.applicantView || caps.staff !== null;
    case 'AUTHORITY_REMARKS':
      // Readable by the uploader's rank and above (plus SYSADMIN); never by JE/applicant.
      return caps.staff === 'SYSADMIN'
        || (caps.rank >= DESK_RANK.AE && caps.rank >= (DESK_RANK[att.uploader_role] ?? Infinity));
    default:
      return false;
  }
}

/**
 * Category a file uploaded through POST /tickets/:id/attachments is stored
 * under, from WHO uploads it (never from the client). null = may not upload.
 */
export function uploadCategory(viewer, ticket) {
  if (!canViewTicket(viewer, ticket)) return null;
  if ([STATUS.CLOSED, STATUS.DENIED].includes(ticket.status)) return null;
  switch (staffRole(viewer, ticket)) {
    case null:         return 'APPLICANT_EVIDENCE';
    case 'JE':         return POST_APPROVAL_STATUSES.includes(ticket.status) ? 'WORK_DOC' : 'JE_ESTIMATE_DOC';
    default:           return 'DESK_DOC'; // AE / SE / Dean / Director / Sysadmin
  }
}

// ---- messages ----------------------------------------------------------------------

/** Filters a ticket's thread by rank; strips staff names for anyone without a staff view. */
export function filterMessages(viewer, ticket, messages) {
  const caps = capabilities(viewer, ticket);
  if (!caps.applicantView && caps.staff === null) return [];
  const reader = { role: caps.staff ?? 'APPLICANT', isApplicant: caps.applicantView };
  return messages
    .filter((m) => canReadMessage(reader, m))
    .map((m) => (caps.identities ? m : { ...m, author_name: null, to_name: null }));
}

// ---- audit log -----------------------------------------------------------------------

const NEUTRAL_AUDIT = Object.freeze({
  CREATED: 'Ticket raised', ASSIGNED: 'Assigned', REASSIGNED: 'Reassigned',
  REMINDER_SENT: 'Reminder sent', SUBMITTED: 'Report submitted', FORWARDED: 'Forwarded for review',
  APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', REJECTED: 'Rejected',
  TENDER_PUBLISHED: 'Tender published', WORK_AWARDED: 'Work awarded', WORK_COMPLETED: 'Work completed',
  WORK_REOPENED: 'Applicant reports work not done',
  CLOSED: 'Closed', OVERRIDE: 'Administrative update', FILES_ADDED: 'Files added',
  PASSED: 'Forwarded for review', RETURNED: 'Returned to JE', DENIED: 'Rejected',
});
// Free text a JE may read: their own, and system lines that carry no authority remark.
const JE_READABLE_REMARK_ACTIONS = new Set(['CREATED', 'ASSIGNED', 'SUBMITTED', 'REMINDER_SENT', 'WORK_REOPENED', 'CLOSED', 'FILES_ADDED']);

/**
 * @param rows  { action, remarks, created_at, actor_name, actor_role, user_id, visibility, from_desk, to_desk }
 */
export function filterAudit(viewer, ticket, rows) {
  const caps = capabilities(viewer, ticket);
  const staff = caps.staff;
  if (staff === null) return []; // the applicant never sees the audit trail

  const shape = (r, { remarks, withName }) => ({
    action: r.action, remarks, created_at: r.created_at, actor_role: r.actor_role,
    ...(withName ? { actor_name: r.actor_name } : {}),
    from_desk: r.from_desk ?? null, to_desk: r.to_desk ?? null,
    is_self_action: !!r.is_self_action,
  });

  if (staff === 'SYSADMIN') return rows.map((r) => shape(r, { remarks: r.remarks, withName: true }));

  const rank = caps.rank;
  const visible = rows.filter((r) => {
    if (r.action === 'REMINDER_SENT') return staff === 'JE' ? r.user_id === viewer.id : caps.reminders;
    // A change request row follows the same rule as its message: readable from the recipient's rank.
    if (r.action === 'CHANGES_REQUESTED' && r.to_desk) return rank >= (DESK_RANK[r.to_desk] ?? Infinity);
    switch (r.visibility ?? 'ALL') {
      case 'ALL':       return true;
      case 'INTERNAL':  return rank >= DESK_RANK.AE;
      case 'AUTHORITY': return rank >= AUTHORITY_MIN_RANK;
      default:          return false;
    }
  });

  if (staff !== 'JE') return visible.map((r) => shape(r, { remarks: r.remarks, withName: true }));

  // JE: movements only. Authority free text is replaced by a neutral line.
  return visible.map((r) => shape(r, {
    remarks: r.actor_role === 'JE' || JE_READABLE_REMARK_ACTIONS.has(r.action)
      ? r.remarks
      : (NEUTRAL_AUDIT[r.action] ?? 'Update recorded'),
    withName: false,
  }));
}

// ---- ticket row + whole details view ---------------------------------------------------

const APPLICANT_FIELDS = [
  'id', 'title', 'type', 'priority', 'department', 'description',
  'campus', 'landmark', 'lat', 'lng', 'contact_phone', 'status', 'created_at', 'updated_at',
  'resolution_kind', 'resolved_at',
];

/** Allow-list projection for a viewer with no staff view: nothing that names a person. */
export function applicantTicket(ticket) {
  const out = {};
  for (const f of APPLICANT_FIELDS) if (ticket[f] !== undefined) out[f] = ticket[f];
  out.stage_label = stageLabel(ticket.status, ticket.resolution_kind);
  return out;
}

const basename = (url) => String(url ?? '').split('/').pop();
// The stored file name carries no user text; the name the uploader chose is `original_name`.
const displayName = (att) => att.original_name || basename(att.file_url);

/**
 * Who attached a file, for the "by person and desk" listing. Every staff viewer, the JE included,
 * sees the person's name. The applicant never gets a staff name or desk: only their own uploads
 * are labelled.
 */
function attachmentOrigin(caps, a) {
  if (caps.staff === null) return a.uploader_desk === 'APPLICANT' ? { uploader_desk: 'APPLICANT' } : {};
  return {
    uploader_desk: a.uploader_desk ?? null,
    uploader_name: a.uploader_name ?? null,
    audit_log_id: a.audit_log_id ?? null,
    audit_action: a.audit_action ?? null,
  };
}

/**
 * Builds the whole details payload for one viewer.
 * @param data { attachments (with uploader_role), reports (newest first), tenders, auditLogs, messages }
 * @returns null when the viewer may not see the ticket at all.
 */
export function buildTicketDetails(viewer, ticket, data) {
  if (!canViewTicket(viewer, ticket)) return null;
  const caps = capabilities(viewer, ticket);

  let out;
  if (caps.staff === null) {
    out = applicantTicket(ticket);
  } else {
    out = { ...ticket };
    if (!caps.applicantContact) {
      delete out.applicant_phone; delete out.applicant_email; delete out.contact_phone;
    }
  }
  out.stage_label = stageLabel(ticket.status, ticket.resolution_kind);

  // Files are never addressed by path: the client only ever gets the
  // authenticated endpoint (S2).
  out.attachments = data.attachments
    .filter((a) => canViewAttachment(viewer, ticket, a))
    .map((a) => ({
      id: a.id, document_category: a.document_category, created_at: a.created_at,
      file_name: displayName(a), download_url: `/api/attachments/${a.id}`,
      ...(a.report_id != null ? { report_id: a.report_id } : {}),
      ...attachmentOrigin(caps, a),
    }));
  out.report = caps.report && data.reports.length > 0 ? data.reports[0] : null;
  out.tenders = caps.tenders ? data.tenders : [];
  out.audit_logs = filterAudit(viewer, ticket, data.auditLogs);
  out.messages = filterMessages(viewer, ticket, data.messages);
  out.reminder_count = caps.reminders || caps.staff === 'JE'
    ? data.auditLogs.filter((r) => r.action === 'REMINDER_SENT' && (caps.reminders || r.user_id === viewer.id)).length
    : null;
  return out;
}
