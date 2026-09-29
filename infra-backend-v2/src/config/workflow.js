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
  WORK_IN_PROGRESS:          'WORK_IN_PROGRESS',
  RETURNED_TO_JE:            'RETURNED_TO_JE',
  DENIED:                    'DENIED',
  CLOSED:                    'CLOSED',
});

export const ROLE = Object.freeze({
  APPLICANT: 'APPLICANT', JE: 'JE', AE: 'AE', SE: 'SE',
  DEAN: 'DEAN', DIRECTOR: 'DIRECTOR', SYSADMIN: 'SYSADMIN',
  CLERICAL: 'CLERICAL', ACCOUNTANT: 'ACCOUNTANT',
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
  WORK_COMPLETED: 'WORK_COMPLETED', BILL_RECORDED: 'BILL_RECORDED',
  BILL_UPDATED: 'BILL_UPDATED', CLOSED: 'CLOSED', OVERRIDE: 'OVERRIDE',
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
const CAN_REJECT  = Object.freeze([DESK.SE, DESK.DEAN, DESK.DIRECTOR]);

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
        d = { action: ACTION.APPROVE, enabled: false, code: 'ABOVE_LIMIT',
              reason: `Estimate ${inr(estimate)} is above your approval limit of ${inr(limit)}. Forward it instead.` };
      }
    }
    actions.push(d);
  }

  const owners = ticket.desk_owners;
  const targets = DESKS_BY_RANK.filter(
    (d) => DESK_RANK[d] < DESK_RANK[desk] && (owners === undefined || owners[d] != null)
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

// ---- post-approval ladder (tender milestones) ---------------------------------

// Tender milestones updated by JE post-approval
export const TENDER_MILESTONES = Object.freeze([
  STATUS.TENDER_PUBLISHED,
  STATUS.WORK_IN_PROGRESS,
  STATUS.CLOSED,
]);

// W6: forward-only. CLOSED is terminal and deliberately absent from the
// "may move" set, so a closed ticket can never accept another milestone.
const TENDER_LADDER = [
  STATUS.APPROVED_FOR_TENDERING,
  STATUS.TENDER_PUBLISHED,
  STATUS.WORK_IN_PROGRESS,
  STATUS.CLOSED,
];
const TENDER_LOG_ACTION = Object.freeze({
  [STATUS.TENDER_PUBLISHED]: LOG_ACTION.TENDER_PUBLISHED,
  [STATUS.WORK_IN_PROGRESS]: LOG_ACTION.WORK_AWARDED,
  [STATUS.CLOSED]:           LOG_ACTION.CLOSED,
});

/** Guard for the JE's tender endpoint — the S1 fix. */
export function resolveTenderUpdate({ currentStatus, milestone }) {
  const currentIdx = TENDER_LADDER.indexOf(currentStatus);
  if (currentIdx === -1 || currentStatus === STATUS.CLOSED) {
    throw new WorkflowError(
      `Tender milestones can only be set after approval and before closure (ticket is at ${currentStatus}).`,
      { code: 'NOT_APPROVED_YET', status: 403 }
    );
  }
  if (!TENDER_MILESTONES.includes(milestone)) {
    throw new WorkflowError(
      `'${milestone}' is not a valid milestone. Allowed: ${TENDER_MILESTONES.join(', ')}.`,
      { code: 'INVALID_MILESTONE', status: 400 }
    );
  }
  const milestoneIdx = TENDER_LADDER.indexOf(milestone);
  if (milestoneIdx <= currentIdx) {
    throw new WorkflowError(
      `Cannot move ticket from ${currentStatus} to ${milestone}. The tender ladder is forward-only.`,
      { code: 'BACKWARD_TRANSITION', status: 409 }
    );
  }
  return { status: milestone, logAction: TENDER_LOG_ACTION[milestone] };
}
