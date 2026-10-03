// ============================================================
//  THE STATE MACHINE — single source of truth for the workflow.
//  Pure functions only: no DB, no Express, no I/O. Every route/controller
//  reads from here; nothing else hardcodes a status, a desk or a limit.
//
//  plan.md §3.3. Desk ranks: JE 1, AE 2, SE 3, Dean 4, Director 5.
//  Status vocabulary is the CURRENT one (PENDING_AE_APPROVAL, RETURNED_TO_JE,
//  DENIED ...); the shorter set from plan.md Q12 is a later rename.
// ============================================================

export const STATUS = Object.freeze({
  UNASSIGNED:                'UNASSIGNED',
  ASSIGNED_TO_JE:            'ASSIGNED_TO_JE',
  PENDING_AE_APPROVAL:       'PENDING_AE_APPROVAL',
  PENDING_SE_APPROVAL:       'PENDING_SE_APPROVAL',
  PENDING_DEAN_APPROVAL:     'PENDING_DEAN_APPROVAL',
  PENDING_DIRECTOR_APPROVAL: 'PENDING_DIRECTOR_APPROVAL',
  APPROVED_FOR_TENDERING:    'APPROVED_FOR_TENDERING',
  TENDER_PUBLISHED:          'TENDER_PUBLISHED',
  TECHNICAL_EVALUATION:      'TECHNICAL_EVALUATION',
  FINANCIAL_EVALUATION:      'FINANCIAL_EVALUATION',
  WORK_IN_PROGRESS:          'WORK_IN_PROGRESS',
  WORK_COMPLETED:            'WORK_COMPLETED',
  RETURNED_TO_JE:            'RETURNED_TO_JE',
  DENIED:                    'DENIED',
  CLOSED:                    'CLOSED',
});

export const ROLE = Object.freeze({
  APPLICANT: 'APPLICANT', JE: 'JE', AE: 'AE', SE: 'SE',
  DEAN: 'DEAN', DIRECTOR: 'DIRECTOR', SYSADMIN: 'SYSADMIN',
});

/** A "desk" is an approval-chain position; desk names equal role names. */
export const DESK = Object.freeze({
  JE: 'JE', AE: 'AE', SE: 'SE', DEAN: 'DEAN', DIRECTOR: 'DIRECTOR',
});
export const DESK_RANK = Object.freeze({ JE: 1, AE: 2, SE: 3, DEAN: 4, DIRECTOR: 5 });
const DESKS_BY_RANK = Object.freeze(['JE', 'AE', 'SE', 'DEAN', 'DIRECTOR']);

export const ACTION = Object.freeze({
  FORWARD:         'FORWARD',
  APPROVE:         'APPROVE',
  REQUEST_CHANGES: 'REQUEST_CHANGES',
  REJECT:          'REJECT',
  ASSIGN_JE:       'ASSIGN_JE',
  SUBMIT_REPORT:   'SUBMIT_REPORT',
});

// Every value the DB ENUM audit_logs.action must hold (migration 005). PASSED,
// RETURNED and DENIED exist only for rows written before that migration.
export const LOG_ACTION = Object.freeze({
  CREATED: 'CREATED', ASSIGNED: 'ASSIGNED', REASSIGNED: 'REASSIGNED',
  REMINDER_SENT: 'REMINDER_SENT', SUBMITTED: 'SUBMITTED', FORWARDED: 'FORWARDED',
  APPROVED: 'APPROVED', CHANGES_REQUESTED: 'CHANGES_REQUESTED', REJECTED: 'REJECTED',
  TENDER_PUBLISHED: 'TENDER_PUBLISHED', WORK_AWARDED: 'WORK_AWARDED',
  WORK_COMPLETED: 'WORK_COMPLETED', WORK_REOPENED: 'WORK_REOPENED',
  CLOSED: 'CLOSED', OVERRIDE: 'OVERRIDE', FILES_ADDED: 'FILES_ADDED',
  TECH_EVAL_STARTED: 'TECH_EVAL_STARTED', FIN_EVAL_STARTED: 'FIN_EVAL_STARTED',
  TENDER_CANCELLED: 'TENDER_CANCELLED', RESOLVED: 'RESOLVED', AUTO_CLOSED: 'AUTO_CLOSED',
  DELETED: 'DELETED', RESTORED: 'RESTORED',
});

/** Thrown for every rule violation, so handlers can map it to a 4xx. */
export class WorkflowError extends Error {
  constructor(message, { code = 'INVALID_TRANSITION', status = 409 } = {}) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
    this.status = status;
  }
}

// ---- desk <-> status tables -------------------------------------------------
const DESK_FOR_STATUS = Object.freeze({
  [STATUS.UNASSIGNED]:                DESK.AE,
  [STATUS.ASSIGNED_TO_JE]:            DESK.JE,
  [STATUS.RETURNED_TO_JE]:            DESK.JE,
  [STATUS.PENDING_AE_APPROVAL]:       DESK.AE,
  [STATUS.PENDING_SE_APPROVAL]:       DESK.SE,
  [STATUS.PENDING_DEAN_APPROVAL]:     DESK.DEAN,
  [STATUS.PENDING_DIRECTOR_APPROVAL]: DESK.DIRECTOR,
});
const STATUS_FOR_DESK = Object.freeze({
  [DESK.JE]:       STATUS.RETURNED_TO_JE,
  [DESK.AE]:       STATUS.PENDING_AE_APPROVAL,
  [DESK.SE]:       STATUS.PENDING_SE_APPROVAL,
  [DESK.DEAN]:     STATUS.PENDING_DEAN_APPROVAL,
  [DESK.DIRECTOR]: STATUS.PENDING_DIRECTOR_APPROVAL,
});
const NEXT_DESK = Object.freeze({ [DESK.AE]: DESK.SE, [DESK.SE]: DESK.DEAN, [DESK.DEAN]: DESK.DIRECTOR });

// Who may APPROVE, and against which financial_limits key. The AE has no
// approval power (Q1); the Director has no limit.
const APPROVAL_LIMIT_KEY = Object.freeze({ [DESK.SE]: 'SE_APPROVE', [DESK.DEAN]: 'DEAN_APPROVE' });
const CAN_APPROVE = Object.freeze([DESK.SE, DESK.DEAN, DESK.DIRECTOR]);
const CAN_REJECT  = Object.freeze([DESK.DIRECTOR]);
const PREV_DESK = Object.freeze({ [DESK.AE]: DESK.JE, [DESK.SE]: DESK.AE, [DESK.DEAN]: DESK.SE, [DESK.DIRECTOR]: DESK.DEAN });

/** Approval-limit summary for a desk, so the UI never hardcodes ceilings (F3).
 *  { can_approve:false } for AE/JE; { unlimited:true } for the Director;
 *  otherwise the configured amount (null = row missing, fail closed). */
export function approvalLimitFor(desk, limits = {}) {
  if (!CAN_APPROVE.includes(desk)) return { can_approve: false, unlimited: false, amount: null };
  const key = APPROVAL_LIMIT_KEY[desk];
  if (!key) return { can_approve: true, unlimited: true, amount: null };
  return { can_approve: true, unlimited: false, amount: limits[key] ?? null };
}

/** Which desk owns a ticket in this status? null = nobody (post-approval or terminal). */
export function deskForStatus(status) {
  return DESK_FOR_STATUS[status] ?? null;
}

const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

/**
 * What can `user` do to `ticket` right now?  THE rule engine for the desks.
 * Pure: same inputs, same output. The frontend renders only from this list.
 *
 * @param {{id:number, role:string}} user
 * @param {{
 *   status:string, current_desk_user_id:(number|null), estimate?:(number|null),
 *   desk_owners?:Object<string,(number|null)>,   // who sits at each lower desk for THIS ticket
 * }} ticket
 * @param {Object<string,number>} limits   financial_limits rows, e.g. { SE_APPROVE: 50000, DEAN_APPROVE: 500000 }
 * @returns {{desk:(string|null), actions:Array<{action:string, enabled:boolean, code?:string, reason?:string, targets?:string[]}>}}
 */
export function availableActions(user, ticket, limits = {}) {
  const desk = deskForStatus(ticket.status);
  // Not this role's desk, or not this exact person (fixes S7: the right ROLE
  // at the wrong PERSON's desk is still refused). Fail closed if unknown.
  if (!desk || user.role !== desk) return { desk, actions: [] };
  if (ticket.current_desk_user_id == null || ticket.current_desk_user_id !== user.id) {
    return { desk, actions: [] };
  }

  if (ticket.status === STATUS.UNASSIGNED) {
    return { desk, actions: [{ action: ACTION.ASSIGN_JE, enabled: true }] };
  }
  if (desk === DESK.JE) {
    return { desk, actions: [{ action: ACTION.SUBMIT_REPORT, enabled: true }] };
  }

  const actions = [];

  const next = NEXT_DESK[desk];
  if (next) actions.push({ action: ACTION.FORWARD, enabled: true, targets: [next] });

  if (CAN_APPROVE.includes(desk)) {
    const key = APPROVAL_LIMIT_KEY[desk];
    const estimate = ticket.estimate;
    let d = { action: ACTION.APPROVE, enabled: true };
    if (estimate == null || Number.isNaN(Number(estimate))) {
      d = { action: ACTION.APPROVE, enabled: false, code: 'ESTIMATE_MISSING',
            reason: 'Cannot approve: no JE estimate on file for this ticket.' };
    } else if (key) {
      const limit = limits[key];
      if (limit == null) {
        // Fail closed: a missing financial_limits row must never mean "no limit".
        d = { action: ACTION.APPROVE, enabled: false, code: 'LIMIT_NOT_CONFIGURED',
              reason: `No financial limit configured for ${key}.` };
      } else if (Number(estimate) > Number(limit)) {
        d = { action: ACTION.APPROVE, enabled: true, escalates_to: NEXT_DESK[desk] };
      }
    }
    actions.push(d);
  }

  const owners = ticket.desk_owners;
  const targets = DESKS_BY_RANK.filter(
    (d) => d === PREV_DESK[desk] && (owners === undefined || owners[d] != null)
  );
  actions.push(targets.length > 0
    ? { action: ACTION.REQUEST_CHANGES, enabled: true, targets }
    : { action: ACTION.REQUEST_CHANGES, enabled: false, code: 'NO_TARGET_DESK',
        reason: 'No lower desk currently has an owner to send changes to.' });

  if (CAN_REJECT.includes(desk)) actions.push({ action: ACTION.REJECT, enabled: true });

  return { desk, actions };
}

/**
 * Validate one requested action against availableActions and compute the
 * transition. Never trusts route-level RBAC: `user` and `ticket` are checked
 * again here.
 *
 * @param {{user, ticket, limits, action:string, to_desk?:string, estimate?:number}} input
 *        `estimate` is only for SUBMIT_REPORT: the amount the JE is filing.
 * @returns {{action, fromDesk, toDesk:(string|null), fromStatus, toStatus, logAction}}
 * @throws {WorkflowError}
 */
export function resolveAction({ user, ticket, limits = {}, action, to_desk, estimate }) {
  const fromStatus = ticket.status;
  const { desk, actions } = availableActions(user, ticket, limits);

  if (!desk) {
    // A JE trying to file a report onto an approved/terminal ticket gets the
    // specific error; everyone else is simply not on the desk.
    if (action === ACTION.SUBMIT_REPORT && user.role === ROLE.JE) {
      throw new WorkflowError(
        `A report can only be filed while the ticket is with the JE (ticket is at ${fromStatus}).`,
        { code: 'REPORT_NOT_ALLOWED', status: 409 });
    }
    throw new WorkflowError(`Ticket is at ${fromStatus}, which is nobody's desk for ${action}.`,
      { code: 'NOT_YOUR_DESK', status: 403 });
  }
  if (user.role !== desk || actions.length === 0) {
    throw new WorkflowError(
      `Ticket is at ${fromStatus}, which is ${desk}'s desk — not yours (${user.role}, or a different person).`,
      { code: 'NOT_YOUR_DESK', status: 403 });
  }

  const descriptor = actions.find((a) => a.action === action);
  if (!descriptor) {
    throw new WorkflowError(
      `${user.role} cannot ${action} at ${fromStatus}. Allowed: ${actions.map((a) => a.action).join(', ') || 'none'}.`,
      { code: 'ACTION_NOT_ALLOWED', status: 403 });
  }
  if (!descriptor.enabled) {
    throw new WorkflowError(descriptor.reason, { code: descriptor.code, status: 409 });
  }

  switch (action) {
    case ACTION.SUBMIT_REPORT: {
      if (estimate === null || estimate === undefined || Number.isNaN(Number(estimate))) {
        throw new WorkflowError('A report must include an estimated amount.',
          { code: 'ESTIMATE_REQUIRED', status: 400 });
      }
      if (Number(estimate) <= 0) {
        throw new WorkflowError(
          'Estimated amount must be greater than zero. If no work is required, the ticket should be closed instead of approved.',
          { code: 'ESTIMATE_INVALID', status: 400 });
      }
      return done(DESK.JE, DESK.AE, STATUS.PENDING_AE_APPROVAL, LOG_ACTION.SUBMITTED);
    }
    case ACTION.ASSIGN_JE:
      return done(DESK.AE, DESK.JE, STATUS.ASSIGNED_TO_JE, LOG_ACTION.ASSIGNED);
    case ACTION.FORWARD: {
      const to = descriptor.targets[0];
      return done(desk, to, STATUS_FOR_DESK[to], LOG_ACTION.FORWARDED);
    }
    case ACTION.APPROVE:
      if (descriptor.escalates_to) {
        const to = descriptor.escalates_to;
        return { ...done(desk, to, STATUS_FOR_DESK[to], LOG_ACTION.FORWARDED), action: ACTION.FORWARD, escalated: true };
      }
      return done(desk, null, STATUS.APPROVED_FOR_TENDERING, LOG_ACTION.APPROVED);
    case ACTION.REJECT:
      return done(desk, null, STATUS.DENIED, LOG_ACTION.REJECTED);
    case ACTION.REQUEST_CHANGES: {
      if (!to_desk) {
        throw new WorkflowError('REQUEST_CHANGES needs to_desk.', { code: 'TO_DESK_REQUIRED', status: 400 });
      }
      if (!descriptor.targets.includes(to_desk)) {
        throw new WorkflowError(
          `${desk} cannot send changes to ${to_desk}. Allowed: ${descriptor.targets.join(', ')}.`,
          { code: 'INVALID_TARGET_DESK', status: 400 });
      }
      return done(desk, to_desk, STATUS_FOR_DESK[to_desk], LOG_ACTION.CHANGES_REQUESTED);
    }
    /* c8 ignore next 2 */
    default:
      throw new WorkflowError(`Unknown action '${action}'.`, { code: 'UNKNOWN_ACTION', status: 400 });
  }

  function done(fromDesk, toDesk, toStatus, logAction) {
    return { action, fromDesk, toDesk, fromStatus, toStatus, logAction };
  }
}

// ---- messages (plan.md §3.1 ticket_messages, §3.6 message rules) --------------

/**
 * Which ticket_messages rows does this action write?  Pure; enforces the
 * payload rules and stamps each row with the visible_from_rank it will keep
 * forever.
 *
 * `openRequest` = the change request currently open on the ticket
 * ({ id, author_desk, to_desk } or null). A desk "replies" when the open
 * request is addressed to it.
 *
 * @returns {Array<{kind, author_desk, to_desk, body, visible_from_rank, in_reply_to}>}
 * @throws {WorkflowError}
 */
export function planMessages({ action, fromDesk, toDesk, payload = {}, openRequest = null }) {
  const { message, internal_remark, public_note } = payload;
  const rank = DESK_RANK[fromDesk];
  const replying = openRequest != null && openRequest.to_desk === fromDesk;
  const specs = [];

  const need = (text, what) => {
    if (typeof text !== 'string' || text.trim() === '') {
      throw new WorkflowError(`${what} requires a message.`, { code: 'MESSAGE_REQUIRED', status: 400 });
    }
    return text.trim();
  };

  if (action === ACTION.REQUEST_CHANGES) {
    specs.push({
      kind: 'CHANGE_REQUEST', author_desk: fromDesk, to_desk: toDesk, body: need(message, 'REQUEST_CHANGES'),
      // CHANGE_REQUEST from X to Y: readable by every desk with rank >= rank(Y).
      visible_from_rank: DESK_RANK[toDesk], in_reply_to: openRequest ? openRequest.id : null,
    });
  } else if (action === ACTION.REJECT) {
    specs.push({
      kind: 'REJECTION_REASON', author_desk: fromDesk, to_desk: null, body: need(message, 'REJECT'),
      visible_from_rank: 1, in_reply_to: null,
    });
  } else if (replying && (action === ACTION.FORWARD || action === ACTION.SUBMIT_REPORT)) {
    // Answering a change request: the reply is mandatory.
    specs.push({
      kind: 'REPLY', author_desk: fromDesk, to_desk: openRequest.author_desk,
      body: need(message, 'Answering a change request'),
      // REPLY from Y to X: rank of Y, same readers as the request it answers.
      visible_from_rank: rank, in_reply_to: openRequest.id,
    });
  } else if (action !== ACTION.SUBMIT_REPORT && typeof message === 'string' && message.trim() !== '') {
    // SUBMIT_REPORT's "message" is the report's own remarks column; every
    // other action that is not a change request/rejection/reply has no use
    // for one -- refuse it rather than silently dropping it.
    throw new WorkflowError(
      `${action} does not take a message. Use internal_remark or public_note.`,
      { code: 'MESSAGE_NOT_ALLOWED', status: 400 });
  }

  if (typeof internal_remark === 'string' && internal_remark.trim() !== '') {
    specs.push({
      kind: 'INTERNAL_REMARK', author_desk: fromDesk, to_desk: null, body: internal_remark.trim(),
      visible_from_rank: rank, in_reply_to: null,
    });
  }
  if (typeof public_note === 'string' && public_note.trim() !== '') {
    specs.push({
      kind: 'PUBLIC_NOTE', author_desk: fromDesk, to_desk: null, body: public_note.trim(),
      visible_from_rank: 0, in_reply_to: null,
    });
  }
  return specs;
}

/**
 * The ticket's open_change_request_id after a move.
 *  - A new REQUEST_CHANGES message becomes the head of the thread.
 *  - A terminal move (approve/reject, toDesk null) closes everything.
 *  - Otherwise, once the ticket climbs back to (or past) the desk that wrote
 *    the open request, that request is answered: pop to its parent, repeat.
 *
 * @param {Object<number,{author_desk:string,in_reply_to:(number|null)}>} messagesById  the open request's thread
 */
export function nextOpenRequestId({ openId, newRequestId = null, toDesk, messagesById = {} }) {
  if (newRequestId != null) return newRequestId;
  if (toDesk == null) return null;
  const arrived = DESK_RANK[toDesk];
  let id = openId ?? null;
  while (id != null) {
    const m = messagesById[id];
    if (!m) return null;
    if (arrived >= DESK_RANK[m.author_desk]) id = m.in_reply_to ?? null;
    else break;
  }
  return id;
}

/**
 * May this viewer read this message? One plain comparison (plan.md §3.6):
 * a desk reads a message when its rank >= the message's visible_from_rank,
 * so lower tiers never see internal executive remarks. PUBLIC_NOTE is the
 * only kind the applicant (or non-desk staff) can read.
 *
 * @param {{role:string, isApplicant?:boolean}} viewer
 */
export function canReadMessage(viewer, message) {
  if (viewer.role === ROLE.SYSADMIN) return true;
  const rank = DESK_RANK[viewer.role] ?? 0;
  if (message.kind === 'PUBLIC_NOTE') return viewer.isApplicant === true || rank >= 1;
  return rank >= 1 && rank >= message.visible_from_rank;
}

// ---- status lists and labels (one place; mirrored in the frontend's lib/ticketUi.ts) ----

/** Statuses after the approval chain, in the order a ticket moves through them. */
export const POST_APPROVAL_STATUSES = Object.freeze([
  STATUS.APPROVED_FOR_TENDERING, STATUS.TENDER_PUBLISHED, STATUS.TECHNICAL_EVALUATION,
  STATUS.FINANCIAL_EVALUATION, STATUS.WORK_IN_PROGRESS, STATUS.WORK_COMPLETED, STATUS.CLOSED,
]);
/** The tender stages: a tender can be cancelled in any of them. */
export const TENDER_STAGES = Object.freeze([
  STATUS.TENDER_PUBLISHED, STATUS.TECHNICAL_EVALUATION, STATUS.FINANCIAL_EVALUATION,
]);
/** Nothing more happens on these without the confirmer or an admin. */
const TERMINAL_STATUSES = Object.freeze([STATUS.CLOSED, STATUS.DENIED]);
/** Statuses the JE may resolve from: everything open except awaiting-confirmation, closed, denied, and no-JE-yet. */
export const RESOLVABLE_STATUSES = Object.freeze(
  Object.values(STATUS).filter((st) => ![STATUS.WORK_COMPLETED, STATUS.UNASSIGNED, ...TERMINAL_STATUSES].includes(st)));

export const STATUS_LABEL = Object.freeze({
  [STATUS.UNASSIGNED]: 'Unassigned',
  [STATUS.ASSIGNED_TO_JE]: 'With JE',
  [STATUS.RETURNED_TO_JE]: 'Returned to JE',
  [STATUS.PENDING_AE_APPROVAL]: 'Pending AE',
  [STATUS.PENDING_SE_APPROVAL]: 'Pending SE',
  [STATUS.PENDING_DEAN_APPROVAL]: 'Pending Dean',
  [STATUS.PENDING_DIRECTOR_APPROVAL]: 'Pending Director',
  [STATUS.APPROVED_FOR_TENDERING]: 'Approved for tendering',
  [STATUS.TENDER_PUBLISHED]: 'Tender published',
  [STATUS.TECHNICAL_EVALUATION]: 'Technical evaluation',
  [STATUS.FINANCIAL_EVALUATION]: 'Financial evaluation',
  [STATUS.WORK_IN_PROGRESS]: 'Work in progress',
  [STATUS.WORK_COMPLETED]: 'Resolved, awaiting confirmation',
  [STATUS.CLOSED]: 'Closed',
  [STATUS.DENIED]: 'Rejected',
});

/** Days a resolved ticket waits for its confirmer before it closes itself. */
export const AUTO_CLOSE_DAYS = 7;

// ---- tender lifecycle, resolve and confirm (Master plan, section 7) -----------------

export const LIFECYCLE = Object.freeze({
  PUBLISH_TENDER:       'PUBLISH_TENDER',
  START_TECHNICAL_EVAL: 'START_TECHNICAL_EVAL',
  START_FINANCIAL_EVAL: 'START_FINANCIAL_EVAL',
  AWARD:                'AWARD',
  CANCEL_TENDER:        'CANCEL_TENDER',
  RESOLVE:              'RESOLVE',
});

export const RESOLUTION = Object.freeze({
  COMPLETED: 'COMPLETED', TENDER_CANCELLED: 'TENDER_CANCELLED', OVERRIDE: 'OVERRIDE',
});

// Where each action may start, and what it produces. The one table behind both
// resolveLifecycleAction (what the server accepts) and availableLifecycleActions (what the UI shows).
const LIFECYCLE_RULES = Object.freeze({
  [LIFECYCLE.PUBLISH_TENDER]:       { from: [STATUS.APPROVED_FOR_TENDERING], to: STATUS.TENDER_PUBLISHED, log: LOG_ACTION.TENDER_PUBLISHED },
  [LIFECYCLE.START_TECHNICAL_EVAL]: { from: [STATUS.TENDER_PUBLISHED], to: STATUS.TECHNICAL_EVALUATION, log: LOG_ACTION.TECH_EVAL_STARTED },
  [LIFECYCLE.START_FINANCIAL_EVAL]: { from: [STATUS.TECHNICAL_EVALUATION], to: STATUS.FINANCIAL_EVALUATION, log: LOG_ACTION.FIN_EVAL_STARTED },
  [LIFECYCLE.AWARD]:                { from: [STATUS.FINANCIAL_EVALUATION], to: STATUS.WORK_IN_PROGRESS, log: LOG_ACTION.WORK_AWARDED },
  [LIFECYCLE.CANCEL_TENDER]:        { from: TENDER_STAGES, to: STATUS.WORK_COMPLETED, log: LOG_ACTION.TENDER_CANCELLED },
  [LIFECYCLE.RESOLVE]:              { from: RESOLVABLE_STATUSES, to: STATUS.WORK_COMPLETED, log: LOG_ACTION.RESOLVED },
});

const MAX_AWARD = 999_999_999_999.99; // DECIMAL(14,2)
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const bad = (message, code = 'VALIDATION_ERROR', status = 400) => new WorkflowError(message, { code, status });
const text = (v) => (typeof v === 'string' ? v.trim() : '');

function validDate(v, field) {
  const d = text(v);
  const t = DATE_ONLY.test(d) ? Date.parse(`${d}T00:00:00Z`) : NaN;
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d) {
    throw bad(`${field} must be a date (YYYY-MM-DD).`, 'INVALID_DATE');
  }
  return d;
}

/**
 * Decides every JE lifecycle step. Pure: no DB. Throws WorkflowError.
 *
 * @param {{id:number, role:string}} user
 * @param {{status:string, assigned_je_id:(number|null)}} ticket
 * @param {string} action   one of LIFECYCLE
 * @param {object} payload  tender_created_date, tender_end_date, nit_number, portal_type, award_amount,
 *                          awarded_agency, reason, note
 * @returns {{action, fromStatus, toStatus, logAction, resolution:(string|null), tender:object, note:(string|null)}}
 */
export function resolveLifecycleAction({ user, ticket, action, payload = {} }) {
  const rule = LIFECYCLE_RULES[action];
  if (!rule) throw bad(`Unknown action '${action}'.`, 'INVALID_ACTION');
  // Only the ticket's own JE. Even a Sysadmin goes through the admin override instead.
  if (user.role !== ROLE.JE || ticket.assigned_je_id == null || ticket.assigned_je_id !== user.id) {
    throw new WorkflowError('Only the JE assigned to this ticket can do this.', { code: 'NOT_YOUR_TICKET', status: 403 });
  }
  const from = ticket.status;
  if (!rule.from.includes(from)) {
    throw new WorkflowError(`${action} is not possible while the ticket is at ${from}.`,
      { code: 'INVALID_TRANSITION', status: 409 });
  }
  const out = { action, fromStatus: from, toStatus: rule.to, logAction: rule.log, resolution: null, tender: {}, note: null };

  switch (action) {
    case LIFECYCLE.PUBLISH_TENDER: {
      const created = validDate(payload.tender_created_date, 'tender_created_date');
      const end = validDate(payload.tender_end_date, 'tender_end_date');
      if (end < created) throw bad('tender_end_date must be on or after tender_created_date.', 'INVALID_DATE_RANGE');
      const portal = text(payload.portal_type) || 'GeM';
      if (!['GeM', 'CPP Portal', 'State Tender'].includes(portal)) throw bad('portal_type is not recognised.', 'INVALID_PORTAL');
      const nit = text(payload.nit_number);
      if (nit.length > 100) throw bad('nit_number must be 100 characters or fewer.');
      out.tender = { tender_created_date: created, tender_end_date: end, portal_type: portal, nit_number: nit || null };
      break;
    }
    case LIFECYCLE.AWARD: {
      const raw = payload.award_amount;
      if (raw === undefined || raw === null || text(String(raw)) === '') throw bad('award_amount is required.', 'AWARD_AMOUNT_REQUIRED');
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount <= 0) throw bad('award_amount must be a number above 0.', 'AWARD_AMOUNT_INVALID');
      if (amount > MAX_AWARD) throw bad(`award_amount must be no greater than ${MAX_AWARD}.`, 'AWARD_AMOUNT_TOO_LARGE');
      const agency = text(payload.awarded_agency);
      if (!agency) throw bad('awarded_agency is required.', 'AGENCY_REQUIRED');
      if (agency.length > 255) throw bad('awarded_agency must be 255 characters or fewer.');
      out.tender = { award_amount: Math.round(amount * 100) / 100, awarded_agency: agency };
      break;
    }
    case LIFECYCLE.CANCEL_TENDER: {
      const reason = text(payload.reason);
      if (!reason) throw bad('Give the reason for cancelling the tender.', 'REASON_REQUIRED');
      if (reason.length > 2000) throw bad('The reason must be 2000 characters or fewer.');
      out.resolution = RESOLUTION.TENDER_CANCELLED;
      out.tender = { cancel_reason: reason };
      out.note = reason;
      break;
    }
    case LIFECYCLE.RESOLVE: {
      const note = text(payload.note ?? payload.reason);
      if (note.length > 2000) throw bad('The note must be 2000 characters or fewer.');
      if (from === STATUS.WORK_IN_PROGRESS) {
        out.resolution = RESOLUTION.COMPLETED;
      } else {
        // Skipping steps is allowed, but never without saying why.
        if (!note) throw bad('Give the reason for resolving the ticket here.', 'REASON_REQUIRED');
        out.resolution = RESOLUTION.OVERRIDE;
      }
      out.note = note || null;
      break;
    }
    default: {
      const note = text(payload.note);
      out.note = note || null;
    }
  }
  return out;
}

/**
 * What the JE may do to this ticket now, from the same table the server enforces.
 * The UI renders only this list.
 * @returns {Array<{action:string, resolution?:string, requires:string[]}>}
 */
export function availableLifecycleActions({ user, ticket }) {
  if (user.role !== ROLE.JE || ticket.assigned_je_id == null || ticket.assigned_je_id !== user.id) return [];
  const needs = {
    [LIFECYCLE.PUBLISH_TENDER]: ['tender_created_date', 'tender_end_date'],
    [LIFECYCLE.AWARD]: ['award_amount', 'awarded_agency'],
    [LIFECYCLE.CANCEL_TENDER]: ['reason'],
  };
  return Object.entries(LIFECYCLE_RULES)
    .filter(([, rule]) => rule.from.includes(ticket.status))
    .map(([action]) => {
      if (action !== LIFECYCLE.RESOLVE) return { action, requires: needs[action] ?? [] };
      const completed = ticket.status === STATUS.WORK_IN_PROGRESS;
      return { action, resolution: completed ? RESOLUTION.COMPLETED : RESOLUTION.OVERRIDE, requires: completed ? [] : ['note'] };
    });
}

/**
 * The confirmer's answer once the ticket was resolved.
 * accepted -> CLOSED. Not accepted -> back to the status it was resolved from (never a status it had
 * not earned), with a reason. A cancelled tender can only be acknowledged: nothing more can happen on it.
 * @param {{status:string, resolved_from_status:(string|null), resolution_kind:(string|null)}} ticket
 */
export function resolveCompletionCheck({ ticket, accepted, remarks }) {
  if (ticket.status !== STATUS.WORK_COMPLETED) {
    throw new WorkflowError(
      `Only a resolved ticket can be confirmed (ticket is at ${ticket.status}).`,
      { code: 'NOT_COMPLETED_YET', status: 409 });
  }
  if (accepted === true) return { status: STATUS.CLOSED, logAction: LOG_ACTION.CLOSED };
  if (accepted !== false) {
    throw new WorkflowError('accepted must be true or false.', { code: 'VALIDATION_ERROR', status: 400 });
  }
  if (ticket.resolution_kind === RESOLUTION.TENDER_CANCELLED) {
    throw new WorkflowError('This tender was cancelled; acknowledge it to close the ticket and raise a new ticket for a new tender.',
      { code: 'SEND_BACK_NOT_ALLOWED', status: 409 });
  }
  if (typeof remarks !== 'string' || remarks.trim() === '') {
    throw new WorkflowError('Say what is still not done.', { code: 'MESSAGE_REQUIRED', status: 400 });
  }
  const back = ticket.resolved_from_status && ticket.resolved_from_status !== STATUS.WORK_COMPLETED
    ? ticket.resolved_from_status : STATUS.WORK_IN_PROGRESS;
  return { status: back, logAction: LOG_ACTION.WORK_REOPENED };
}
