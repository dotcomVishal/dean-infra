// ============================================================
//  THE STATE MACHINE — single source of truth for the workflow.
//  Pure functions only: no DB, no Express, no I/O.
//  Every route handler reads from here. Nothing hardcodes a status.
// ============================================================

export const STATUS = Object.freeze({
  ASSIGNED_TO_JE:            'ASSIGNED_TO_JE',
  PENDING_AE_APPROVAL:       'PENDING_AE_APPROVAL',
  PENDING_SE_APPROVAL:       'PENDING_SE_APPROVAL',
  PENDING_DEAN_APPROVAL:     'PENDING_DEAN_APPROVAL',
  PENDING_DIRECTOR_APPROVAL: 'PENDING_DIRECTOR_APPROVAL',
  APPROVED_FOR_TENDERING:    'APPROVED_FOR_TENDERING',
  RETURNED_TO_JE:            'RETURNED_TO_JE',
  DENIED:                    'DENIED',
  CLOSED:                    'CLOSED',
});

export const ROLE = Object.freeze({
  APPLICANT: 'APPLICANT', JE: 'JE', AE: 'AE', SE: 'SE',
  DEAN: 'DEAN', DIRECTOR: 'DIRECTOR', SYSADMIN: 'SYSADMIN', CLERICAL: 'CLERICAL',
});


// export const INCLUDE_SE = true;

export const BUDGET_CEILING = Object.freeze({
  AE:       25_000,   
  SE:       50_000,   
  DEAN:    500_000,   
  DIRECTOR: Infinity, 
});

export const APPROVAL_CHAIN = [ROLE.AE, ROLE.SE, ROLE.DEAN, ROLE.DIRECTOR];

const PENDING_STATUS_FOR = {
  AE:       STATUS.PENDING_AE_APPROVAL,
  SE:       STATUS.PENDING_SE_APPROVAL,
  DEAN:     STATUS.PENDING_DEAN_APPROVAL,
  DIRECTOR: STATUS.PENDING_DIRECTOR_APPROVAL,
};

// LATER add real tender stages here once you know them, e.g.
// 'TENDER_PUBLISHED', 'WORK_ORDER_ISSUED', 'WORK_IN_PROGRESS', 'COMPLETED'.
export const TENDER_MILESTONES = Object.freeze([
  STATUS.CLOSED,
]);
// --- end config -------------------------------------------------------------


// Every value that can ever land in audit_logs.action. The DB ENUM must hold
// EXACTLY this list
export const LOG_ACTION = Object.freeze({
  CREATED:   'CREATED',    // ticket raised
  ASSIGNED:  'ASSIGNED',   // auto-assigned to a JE
  SUBMITTED: 'SUBMITTED',  // JE files report + estimate   <-- MISSING from the DB
  PASSED:    'PASSED',     // escalated to the next desk
  APPROVED:  'APPROVED',   // sanctioned within this desk's ceiling
  RETURNED:  'RETURNED',   // sent back for revision
  DENIED:    'DENIED',     // Director rejects outright
});


/** Thrown for every rule violation, so handlers can map it to a 403/409. */
export class WorkflowError extends Error {
  constructor(message, { code = 'INVALID_TRANSITION', status = 409 } = {}) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
    this.status = status;
  }
}

/** Who owns a ticket in this status? null = terminal, nobody. */
export function actorForStatus(status) {
  // The JE owns the ticket while inspecting it, AND again after approval while
  // driving tender milestones.
  if (status === STATUS.ASSIGNED_TO_JE ||
      status === STATUS.RETURNED_TO_JE ||
      status === STATUS.APPROVED_FOR_TENDERING) return ROLE.JE;
  return Object.keys(PENDING_STATUS_FOR).find(r => PENDING_STATUS_FOR[r] === status) ?? null;
}

/** The next desk up the ladder, or null at the top. */
function nextApprover(role) {
  const i = APPROVAL_CHAIN.indexOf(role);
  if (i === -1) return null;
  return APPROVAL_CHAIN[i + 1] ?? null;
}

/** The desk immediately below in the ladder, or JE if at the bottom of the approval chain. */
function previousDesk(role) {
  const i = APPROVAL_CHAIN.indexOf(role);
  if (i === -1) return null;
  if (i === 0) return ROLE.JE; // AE returns back to JE
  return APPROVAL_CHAIN[i - 1]; // SE -> AE, DEAN -> SE, DIRECTOR -> DEAN
}

/**
 * THE core rule engine. Pure: same inputs always give the same output.
 * @returns {{ status: string, logAction: string }}
 * @throws {WorkflowError}
 */
export function resolveTransition({ currentStatus, role, action, estimate }) {
  // Rule 0: it must be this role's turn. This is the guard v1 never had, which
  // let a DIRECTOR approve a ticket still at ASSIGNED_TO_JE — skipping the JE.
  const expected = actorForStatus(currentStatus);
  if (expected !== role) {
    throw new WorkflowError(
      `Ticket is at ${currentStatus}, which is ${expected ?? 'nobody'}'s desk — not ${role}'s.`,
      { code: 'NOT_YOUR_DESK', status: 403 }
    );
  }

  if (role === ROLE.JE) {
    // A JE has exactly ONE move in the approval flow. Be explicit and closed:
    if (action === 'SUBMIT_REPORT') {
      // Only from the two "JE is inspecting" states. Never from an approved
      // ticket, or a JE could drag sanctioned work back down to the AE.
      if (currentStatus !== STATUS.ASSIGNED_TO_JE && currentStatus !== STATUS.RETURNED_TO_JE) {
        throw new WorkflowError(
          `A report can only be filed from ${STATUS.ASSIGNED_TO_JE} or ${STATUS.RETURNED_TO_JE} ` +
          `(ticket is at ${currentStatus}).`,
          { code: 'REPORT_NOT_ALLOWED', status: 409 }
        );
      }
      // No estimate = no way to apply a ceiling. Hard fail, never guess.
      if (estimate === null || estimate === undefined || Number.isNaN(Number(estimate))) {
        throw new WorkflowError('A report must include an estimated amount.',
          { code: 'ESTIMATE_REQUIRED', status: 400 });
      }
      if (Number(estimate) < 0) {
        throw new WorkflowError('Estimated amount cannot be negative.',
          { code: 'ESTIMATE_INVALID', status: 400 });
      }
      return { status: STATUS.PENDING_AE_APPROVAL, logAction: 'SUBMITTED' };
    }

    // Tender milestones go through resolveTenderUpdate(), not here.
    throw new WorkflowError(
      `A JE cannot '${action}' a ticket. A JE may only submit a report; ` +
      `approvals belong to AE/SE/Dean/Director.`,
      { code: 'JE_ACTION_NOT_ALLOWED', status: 403 }
    );
  }

  // ---- Approver actions ---------------------------------------------------
  // ---- Approver actions ---------------------------------------------------
  if (action === 'RETURN') {
    const prev = previousDesk(role);
    if (!prev) {
      throw new WorkflowError(`Cannot return ticket from ${role}.`, {
        code: 'CANNOT_RETURN',
        status: 400,
      });
    }

    // Returning to JE uses the dedicated RETURNED_TO_JE status
    if (prev === ROLE.JE) {
      return { status: STATUS.RETURNED_TO_JE, logAction: 'RETURNED' };
    }

    // Returning to higher officers puts it back in their pending queue
    return { status: PENDING_STATUS_FOR[prev], logAction: 'RETURNED' };
  }

  if (action === 'DENY') {
    // Only director can deny
    if (role !== ROLE.DIRECTOR) {
      throw new WorkflowError(`Only the DIRECTOR can deny a ticket. ${role} can RETURN it.`,
        { code: 'DENY_NOT_ALLOWED', status: 403 });
    }
    return { status: STATUS.DENIED, logAction: 'DENIED' };
  }

  if (action === 'APPROVE') {
    if (estimate === null || estimate === undefined || Number.isNaN(Number(estimate))) {
      throw new WorkflowError('Cannot approve: no JE estimate on file for this ticket.',
        { code: 'ESTIMATE_MISSING', status: 409 });
    }
    const amount = Number(estimate);
    const ceiling = BUDGET_CEILING[role];

    if (amount <= ceiling) {
      return { status: STATUS.APPROVED_FOR_TENDERING, logAction: 'APPROVED' };
    }
    const next = nextApprover(role);
    if (!next) {
      throw new WorkflowError('No higher authority to escalate to.',
        { code: 'NO_HIGHER_AUTHORITY', status: 409 });
    }
    return { status: PENDING_STATUS_FOR[next], logAction: 'PASSED' };
  }

  throw new WorkflowError(`Unknown action '${action}'.`, { code: 'UNKNOWN_ACTION', status: 400 });
}

/** Guard for the JE's tender endpoint — this is the S1 fix. */
export function resolveTenderUpdate({ currentStatus, milestone }) {
  // Stage check FIRST. If the ticket isn't approved, no milestone value would
  // work — so reporting "invalid milestone" would wrongly imply that a
  // different value would have succeeded.
  if (currentStatus !== STATUS.APPROVED_FOR_TENDERING && currentStatus !== STATUS.CLOSED) {
    throw new WorkflowError(
      `Tender milestones can only be set after approval (ticket is at ${currentStatus}).`,
      { code: 'NOT_APPROVED_YET', status: 403 }
    );
  }
  if (!TENDER_MILESTONES.includes(milestone)) {
    throw new WorkflowError(
      `'${milestone}' is not a valid milestone. Allowed: ${TENDER_MILESTONES.join(', ')}.`,
      { code: 'INVALID_MILESTONE', status: 400 }
    );
  }
  return { status: milestone, logAction: 'PASSED' };
}

/** For the frontend: should this user see the action buttons? */
export function canAct(role, currentStatus) {
  return actorForStatus(currentStatus) === role;
}