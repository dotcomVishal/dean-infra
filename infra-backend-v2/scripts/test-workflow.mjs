// Table-driven tests for the pure state machine (src/config/workflow.js).
// No DB, no network. Runs standalone (`node scripts/test-workflow.mjs`) or
// under `node --test scripts/test-workflow.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS, ROLE, ACTION, WorkflowError, availableActions, resolveAction, planMessages,
  nextOpenRequestId, canReadMessage, resolveTenderStage, resolveResolution, resolveCompletionCheck, deskForStatus,
  tenderStagesFrom, jeTenderActions, canResolveFrom, TENDER_STAGES, MAX_AMOUNT,
} from '../src/config/workflow.js';

const LIMITS = { SE_APPROVE: 50_000, DEAN_APPROVE: 500_000 };
const ALL_OWNERS = { JE: 11, AE: 12, SE: 13, DEAN: 14, DIRECTOR: 15 };

// Person ids: each desk's owner id equals the entry in ALL_OWNERS.
const user = (role) => ({ id: ALL_OWNERS[role] ?? 99, role });
const ticket = (status, over = {}) => ({
  status,
  current_desk_user_id: ALL_OWNERS[deskForStatus(status)] ?? null,
  estimate: 20_000,
  desk_owners: ALL_OWNERS,
  ...over,
});
const names = (r) => r.actions.map((a) => a.action);
const find = (r, action) => r.actions.find((a) => a.action === action);
const throwsCode = (fn, code) => {
  assert.throws(fn, (e) => e instanceof WorkflowError && e.code === code, `expected ${code}`);
};

// ---- availableActions: role x status -> action names ----------------------------------
const MATRIX = [
  // [role, status, expected action names in order]
  [ROLE.AE,       STATUS.UNASSIGNED,                ['ASSIGN_JE']],
  [ROLE.JE,       STATUS.ASSIGNED_TO_JE,            ['SUBMIT_REPORT']],
  [ROLE.JE,       STATUS.RETURNED_TO_JE,            ['SUBMIT_REPORT']],
  [ROLE.AE,       STATUS.PENDING_AE_APPROVAL,       ['FORWARD', 'REQUEST_CHANGES']],          // AE: no approve, no reject (Q1)
  [ROLE.SE,       STATUS.PENDING_SE_APPROVAL,       ['FORWARD', 'APPROVE', 'REQUEST_CHANGES']],
  [ROLE.DEAN,     STATUS.PENDING_DEAN_APPROVAL,     ['FORWARD', 'APPROVE', 'REQUEST_CHANGES']],
  [ROLE.DIRECTOR, STATUS.PENDING_DIRECTOR_APPROVAL, ['APPROVE', 'REQUEST_CHANGES', 'REJECT']], // Director: no forward
];
for (const [role, status, expected] of MATRIX) {
  test(`availableActions: ${role} at ${status} -> ${expected.join(', ')}`, () => {
    assert.deepEqual(names(availableActions(user(role), ticket(status), LIMITS)), expected);
  });
}

// Every (role, status) pair NOT on the matrix has no actions at all.
for (const status of Object.values(STATUS)) {
  for (const role of Object.values(ROLE)) {
    if (MATRIX.some(([r, s]) => r === role && s === status)) continue;
    test(`availableActions: ${role} at ${status} -> nothing`, () => {
      assert.deepEqual(availableActions(user(role), ticket(status), LIMITS).actions, []);
    });
  }
}

test('wrong PERSON at the right desk gets nothing (S7)', () => {
  const t = ticket(STATUS.PENDING_SE_APPROVAL);
  assert.deepEqual(availableActions({ id: 777, role: ROLE.SE }, t, LIMITS).actions, []);
});
test('unknown desk owner fails closed', () => {
  const t = ticket(STATUS.PENDING_SE_APPROVAL, { current_desk_user_id: null });
  assert.deepEqual(availableActions(user(ROLE.SE), t, LIMITS).actions, []);
});

// ---- rank-based routing of REQUEST_CHANGES targets -------------------------------------
const TARGETS = [
  [ROLE.AE,       STATUS.PENDING_AE_APPROVAL,       ['JE']],
  [ROLE.SE,       STATUS.PENDING_SE_APPROVAL,       ['AE']],
  [ROLE.DEAN,     STATUS.PENDING_DEAN_APPROVAL,     ['SE']],
  [ROLE.DIRECTOR, STATUS.PENDING_DIRECTOR_APPROVAL, ['DEAN']],
];
for (const [role, status, expected] of TARGETS) {
  test(`REQUEST_CHANGES targets for ${role}: only the previous desk (${expected.join(', ')})`, () => {
    assert.deepEqual(find(availableActions(user(role), ticket(status), LIMITS), 'REQUEST_CHANGES').targets, expected);
  });
}

test('target-desk availability: previous desk with no owner is not offered', () => {
  const t = ticket(STATUS.PENDING_DEAN_APPROVAL, { desk_owners: { JE: 11, AE: 12, SE: null } });
  const d = find(availableActions(user(ROLE.DEAN), t, LIMITS), 'REQUEST_CHANGES');
  assert.equal(d.enabled, false);
});
test('target-desk availability: no available lower desk disables REQUEST_CHANGES', () => {
  const t = ticket(STATUS.PENDING_AE_APPROVAL, { desk_owners: { JE: null } });
  const d = find(availableActions(user(ROLE.AE), t, LIMITS), 'REQUEST_CHANGES');
  assert.equal(d.enabled, false);
  assert.equal(d.code, 'NO_TARGET_DESK');
});

// ---- financial guard on APPROVE ---------------------------------------------------------
const APPROVE_CASES = [
  // [role, status, estimate, limits, expected enabled, expected code]
  [ROLE.SE,       STATUS.PENDING_SE_APPROVAL,       50_000,    LIMITS, true,  undefined],            // exactly at limit
  [ROLE.SE,       STATUS.PENDING_SE_APPROVAL,       50_000.01, LIMITS, true,  undefined],
  [ROLE.SE,       STATUS.PENDING_SE_APPROVAL,       400_000,   LIMITS, true,  undefined],
  [ROLE.DEAN,     STATUS.PENDING_DEAN_APPROVAL,     500_000,   LIMITS, true,  undefined],            // 5 lakh
  [ROLE.DEAN,     STATUS.PENDING_DEAN_APPROVAL,     500_001,   LIMITS, true,  undefined],
  [ROLE.DIRECTOR, STATUS.PENDING_DIRECTOR_APPROVAL, 99_999_999, LIMITS, true, undefined],            // no limit
  [ROLE.SE,       STATUS.PENDING_SE_APPROVAL,       null,      LIMITS, false, 'ESTIMATE_MISSING'],
  [ROLE.SE,       STATUS.PENDING_SE_APPROVAL,       10_000,    {},     false, 'LIMIT_NOT_CONFIGURED'], // fail closed
];
for (const [role, status, estimate, limits, enabled, code] of APPROVE_CASES) {
  test(`APPROVE ${role} estimate=${estimate} limits=${JSON.stringify(limits)} -> enabled=${enabled}${code ? ` (${code})` : ''}`, () => {
    const d = find(availableActions(user(role), ticket(status, { estimate }), limits), 'APPROVE');
    assert.equal(d.enabled, enabled);
    assert.equal(d.code, code);
  });
}
test('APPROVE above the limit escalates to the next desk as a FORWARD', () => {
  const se = resolveAction({ user: user(ROLE.SE), ticket: ticket(STATUS.PENDING_SE_APPROVAL, { estimate: 60_000 }), limits: LIMITS, action: ACTION.APPROVE });
  assert.equal(se.toStatus, STATUS.PENDING_DEAN_APPROVAL);
  assert.equal(se.logAction, 'FORWARDED');
  assert.equal(se.action, ACTION.FORWARD);
  assert.equal(se.escalated, true);
  const dean = resolveAction({ user: user(ROLE.DEAN), ticket: ticket(STATUS.PENDING_DEAN_APPROVAL, { estimate: 600_000 }), limits: LIMITS, action: ACTION.APPROVE });
  assert.equal(dean.toStatus, STATUS.PENDING_DIRECTOR_APPROVAL);
});

// ---- resolveAction transitions -----------------------------------------------------------
const TRANSITIONS = [
  // [role, status, action, to_desk, expected toStatus, expected logAction, expected toDesk]
  [ROLE.AE,       STATUS.UNASSIGNED,                'ASSIGN_JE',       undefined, STATUS.ASSIGNED_TO_JE,            'ASSIGNED',          'JE'],
  [ROLE.AE,       STATUS.PENDING_AE_APPROVAL,       'FORWARD',         undefined, STATUS.PENDING_SE_APPROVAL,       'FORWARDED',         'SE'],
  [ROLE.AE,       STATUS.PENDING_AE_APPROVAL,       'REQUEST_CHANGES', 'JE',      STATUS.RETURNED_TO_JE,            'CHANGES_REQUESTED', 'JE'],
  [ROLE.SE,       STATUS.PENDING_SE_APPROVAL,       'FORWARD',         undefined, STATUS.PENDING_DEAN_APPROVAL,     'FORWARDED',         'DEAN'],
  [ROLE.SE,       STATUS.PENDING_SE_APPROVAL,       'APPROVE',         undefined, STATUS.APPROVED_FOR_TENDERING,    'APPROVED',          null],
  [ROLE.SE,       STATUS.PENDING_SE_APPROVAL,       'REQUEST_CHANGES', 'AE',      STATUS.PENDING_AE_APPROVAL,       'CHANGES_REQUESTED', 'AE'],
  [ROLE.DEAN,     STATUS.PENDING_DEAN_APPROVAL,     'FORWARD',         undefined, STATUS.PENDING_DIRECTOR_APPROVAL, 'FORWARDED',         'DIRECTOR'],
  [ROLE.DEAN,     STATUS.PENDING_DEAN_APPROVAL,     'REQUEST_CHANGES', 'SE',      STATUS.PENDING_SE_APPROVAL,       'CHANGES_REQUESTED', 'SE'],
  [ROLE.DIRECTOR, STATUS.PENDING_DIRECTOR_APPROVAL, 'APPROVE',         undefined, STATUS.APPROVED_FOR_TENDERING,    'APPROVED',          null],
  [ROLE.DIRECTOR, STATUS.PENDING_DIRECTOR_APPROVAL, 'REQUEST_CHANGES', 'DEAN',    STATUS.PENDING_DEAN_APPROVAL,     'CHANGES_REQUESTED', 'DEAN'],
  [ROLE.DIRECTOR, STATUS.PENDING_DIRECTOR_APPROVAL, 'REJECT',          undefined, STATUS.DENIED,                    'REJECTED',          null],
];
for (const [role, status, action, to_desk, toStatus, logAction, toDesk] of TRANSITIONS) {
  test(`resolveAction: ${role} ${action}${to_desk ? ` -> ${to_desk}` : ''} at ${status} => ${toStatus}`, () => {
    const r = resolveAction({ user: user(role), ticket: ticket(status), limits: LIMITS, action, to_desk });
    assert.equal(r.toStatus, toStatus);
    assert.equal(r.logAction, logAction);
    assert.equal(r.toDesk, toDesk);
    assert.equal(r.fromStatus, status);
  });
}
test('JE SUBMIT_REPORT -> PENDING_AE_APPROVAL / SUBMITTED', () => {
  const r = resolveAction({ user: user(ROLE.JE), ticket: ticket(STATUS.ASSIGNED_TO_JE), action: 'SUBMIT_REPORT', estimate: 5000 });
  assert.equal(r.toStatus, STATUS.PENDING_AE_APPROVAL);
  assert.equal(r.logAction, 'SUBMITTED');
});

// ---- refusals ----------------------------------------------------------------------------
const REFUSALS = [
  ['AE cannot APPROVE (Q1)',                        ROLE.AE,       STATUS.PENDING_AE_APPROVAL,       'APPROVE',         undefined, 'ACTION_NOT_ALLOWED'],
  ['AE cannot REJECT (Q1)',                         ROLE.AE,       STATUS.PENDING_AE_APPROVAL,       'REJECT',          undefined, 'ACTION_NOT_ALLOWED'],
  ['SE cannot REJECT',                              ROLE.SE,       STATUS.PENDING_SE_APPROVAL,       'REJECT',          undefined, 'ACTION_NOT_ALLOWED'],
  ['Dean cannot REJECT',                            ROLE.DEAN,     STATUS.PENDING_DEAN_APPROVAL,     'REJECT',          undefined, 'ACTION_NOT_ALLOWED'],
  ['Director cannot skip to JE',                    ROLE.DIRECTOR, STATUS.PENDING_DIRECTOR_APPROVAL, 'REQUEST_CHANGES', 'JE',      'INVALID_TARGET_DESK'],
  ['Director cannot FORWARD (no forward)',          ROLE.DIRECTOR, STATUS.PENDING_DIRECTOR_APPROVAL, 'FORWARD',         undefined, 'ACTION_NOT_ALLOWED'],
  ['SE cannot send changes to Dean (upwards)',      ROLE.SE,       STATUS.PENDING_SE_APPROVAL,       'REQUEST_CHANGES', 'DEAN',    'INVALID_TARGET_DESK'],
  ['SE cannot send changes to itself',              ROLE.SE,       STATUS.PENDING_SE_APPROVAL,       'REQUEST_CHANGES', 'SE',      'INVALID_TARGET_DESK'],
  ['AE cannot send changes to SE',                  ROLE.AE,       STATUS.PENDING_AE_APPROVAL,       'REQUEST_CHANGES', 'SE',      'INVALID_TARGET_DESK'],
  ['REQUEST_CHANGES without to_desk',               ROLE.SE,       STATUS.PENDING_SE_APPROVAL,       'REQUEST_CHANGES', undefined, 'TO_DESK_REQUIRED'],
  ['Director cannot act on SE desk',                ROLE.DIRECTOR, STATUS.PENDING_SE_APPROVAL,       'APPROVE',         undefined, 'NOT_YOUR_DESK'],
  ['AE cannot act on Dean desk',                    ROLE.AE,       STATUS.PENDING_DEAN_APPROVAL,     'FORWARD',         undefined, 'NOT_YOUR_DESK'],
  ['SYSADMIN has no desk actions',                  ROLE.SYSADMIN, STATUS.PENDING_SE_APPROVAL,       'APPROVE',         undefined, 'NOT_YOUR_DESK'],
  ['nobody acts on an approved ticket',             ROLE.DIRECTOR, STATUS.APPROVED_FOR_TENDERING,    'APPROVE',         undefined, 'NOT_YOUR_DESK'],
  ['nobody acts on a denied ticket',                ROLE.DEAN,     STATUS.DENIED,                    'APPROVE',         undefined, 'NOT_YOUR_DESK'],
  ['AE cannot ASSIGN_JE on a normal ticket',        ROLE.AE,       STATUS.PENDING_AE_APPROVAL,       'ASSIGN_JE',       undefined, 'ACTION_NOT_ALLOWED'],
];
for (const [name, role, status, action, to_desk, code] of REFUSALS) {
  test(`refuses: ${name}`, () => {
    throwsCode(() => resolveAction({ user: user(role), ticket: ticket(status), limits: LIMITS, action, to_desk }), code);
  });
}
test('refuses: wrong person at the right desk', () => {
  throwsCode(() => resolveAction({
    user: { id: 777, role: ROLE.SE }, ticket: ticket(STATUS.PENDING_SE_APPROVAL), limits: LIMITS, action: 'FORWARD',
  }), 'NOT_YOUR_DESK');
});
test('refuses: JE report with no / zero / NaN estimate', () => {
  for (const [estimate, code] of [[undefined, 'ESTIMATE_REQUIRED'], [null, 'ESTIMATE_REQUIRED'], [0, 'ESTIMATE_INVALID'], [-1, 'ESTIMATE_INVALID'], [NaN, 'ESTIMATE_REQUIRED']]) {
    throwsCode(() => resolveAction({ user: user(ROLE.JE), ticket: ticket(STATUS.ASSIGNED_TO_JE), action: 'SUBMIT_REPORT', estimate }), code);
  }
});
test('refuses: JE filing onto an approved ticket -> REPORT_NOT_ALLOWED', () => {
  throwsCode(() => resolveAction({
    user: user(ROLE.JE), ticket: ticket(STATUS.APPROVED_FOR_TENDERING), action: 'SUBMIT_REPORT', estimate: 5000,
  }), 'REPORT_NOT_ALLOWED');
});
test('refuses: JE cannot do a desk action', () => {
  throwsCode(() => resolveAction({ user: user(ROLE.JE), ticket: ticket(STATUS.ASSIGNED_TO_JE), action: 'APPROVE' }), 'ACTION_NOT_ALLOWED');
});

// ---- planMessages: threading + visible_from_rank ---------------------------------------------
test('CHANGE_REQUEST Dean -> SE: visible_from_rank = rank(SE)=3, not the sender rank', () => {
  const [m] = planMessages({ action: 'REQUEST_CHANGES', fromDesk: 'DEAN', toDesk: 'SE', payload: { message: 'fix estimate' } });
  assert.equal(m.kind, 'CHANGE_REQUEST');
  assert.equal(m.visible_from_rank, 3);
  assert.equal(m.to_desk, 'SE');
  assert.equal(m.in_reply_to, null);
});
test('CHANGE_REQUEST passed further down links in_reply_to the open request', () => {
  const [m] = planMessages({
    action: 'REQUEST_CHANGES', fromDesk: 'SE', toDesk: 'JE', payload: { message: 'redo' },
    openRequest: { id: 41, author_desk: 'DEAN', to_desk: 'SE' },
  });
  assert.equal(m.in_reply_to, 41);
  assert.equal(m.visible_from_rank, 1);
});
test('REQUEST_CHANGES and REJECT need a message', () => {
  throwsCode(() => planMessages({ action: 'REQUEST_CHANGES', fromDesk: 'AE', toDesk: 'JE', payload: {} }), 'MESSAGE_REQUIRED');
  throwsCode(() => planMessages({ action: 'REJECT', fromDesk: 'SE', toDesk: null, payload: { message: '  ' } }), 'MESSAGE_REQUIRED');
});
test('FORWARD answering a request addressed to this desk needs a REPLY, ranked by the replier', () => {
  const open = { id: 41, author_desk: 'DEAN', to_desk: 'SE' };
  throwsCode(() => planMessages({ action: 'FORWARD', fromDesk: 'SE', toDesk: 'DEAN', payload: {}, openRequest: open }), 'MESSAGE_REQUIRED');
  const [m] = planMessages({ action: 'FORWARD', fromDesk: 'SE', toDesk: 'DEAN', payload: { message: 'done' }, openRequest: open });
  assert.equal(m.kind, 'REPLY');
  assert.equal(m.to_desk, 'DEAN');
  assert.equal(m.visible_from_rank, 3);
  assert.equal(m.in_reply_to, 41);
});
test('plain FORWARD rejects a stray message; internal_remark is the way', () => {
  throwsCode(() => planMessages({ action: 'FORWARD', fromDesk: 'AE', toDesk: 'SE', payload: { message: 'hi' } }), 'MESSAGE_NOT_ALLOWED');
  const [m] = planMessages({ action: 'FORWARD', fromDesk: 'AE', toDesk: 'SE', payload: { internal_remark: 'watch cost' } });
  assert.equal(m.kind, 'INTERNAL_REMARK');
  assert.equal(m.visible_from_rank, 2);
});
test('public_note is rank 0; rejection reason rank 1', () => {
  const specs = planMessages({ action: 'REJECT', fromDesk: 'SE', toDesk: null, payload: { message: 'no budget', public_note: 'not approved' } });
  assert.deepEqual(specs.map((s) => [s.kind, s.visible_from_rank]), [['REJECTION_REASON', 1], ['PUBLIC_NOTE', 0]]);
});
test('JE report replying to a request addressed to JE needs remarks', () => {
  const open = { id: 9, author_desk: 'AE', to_desk: 'JE' };
  throwsCode(() => planMessages({ action: 'SUBMIT_REPORT', fromDesk: 'JE', toDesk: 'AE', payload: {}, openRequest: open }), 'MESSAGE_REQUIRED');
  const [m] = planMessages({ action: 'SUBMIT_REPORT', fromDesk: 'JE', toDesk: 'AE', payload: { message: 'fixed' }, openRequest: open });
  assert.equal(m.kind, 'REPLY');
  assert.equal(m.visible_from_rank, 1);
});
test('JE report not answering anything writes no message (remarks live on the report)', () => {
  assert.deepEqual(planMessages({ action: 'SUBMIT_REPORT', fromDesk: 'JE', toDesk: 'AE', payload: { message: 'notes' } }), []);
});

// ---- open_change_request_id lifecycle -----------------------------------------------------------
const thread = {
  1: { author_desk: 'DEAN', in_reply_to: null },   // Dean -> SE
  2: { author_desk: 'SE',   in_reply_to: 1 },      // SE -> JE (passing it down)
};
test('open request stays while the ticket is below the requester', () => {
  assert.equal(nextOpenRequestId({ openId: 2, toDesk: 'AE', messagesById: thread }), 2); // JE -> AE: rank 2 < 3
});
test('open request pops to its parent when the ticket reaches the requesting desk', () => {
  assert.equal(nextOpenRequestId({ openId: 2, toDesk: 'SE', messagesById: thread }), 1); // reaches SE (author of 2)
  assert.equal(nextOpenRequestId({ openId: 1, toDesk: 'DEAN', messagesById: thread }), null); // reaches Dean (author of 1)
});
test('terminal moves clear the request; a new request becomes the head', () => {
  assert.equal(nextOpenRequestId({ openId: 2, toDesk: null, messagesById: thread }), null);
  assert.equal(nextOpenRequestId({ openId: 1, newRequestId: 77, toDesk: 'JE', messagesById: thread }), 77);
});

// ---- message visibility ----------------------------------------------------------------------------
const M = (kind, visible_from_rank) => ({ kind, visible_from_rank });
const VIS = [
  // [viewer, message, can read]
  [{ role: 'JE' },       M('INTERNAL_REMARK', 4),   false], // Dean's internal remark hidden from JE
  [{ role: 'AE' },       M('INTERNAL_REMARK', 4),   false],
  [{ role: 'SE' },       M('INTERNAL_REMARK', 4),   false],
  [{ role: 'DEAN' },     M('INTERNAL_REMARK', 4),   true],
  [{ role: 'DIRECTOR' }, M('INTERNAL_REMARK', 4),   true],
  [{ role: 'JE' },       M('CHANGE_REQUEST', 1),    true],  // request addressed to JE
  [{ role: 'JE' },       M('CHANGE_REQUEST', 3),    false], // request addressed to SE: JE never sees
  [{ role: 'AE' },       M('CHANGE_REQUEST', 3),    false],
  [{ role: 'SE' },       M('CHANGE_REQUEST', 3),    true],
  [{ role: 'AE' },       M('CHANGE_REQUEST', 1),    true],  // SE -> JE passes through the AE desk
  [{ role: 'SYSADMIN' }, M('INTERNAL_REMARK', 5),   true],
  [{ role: 'CLERICAL' }, M('CHANGE_REQUEST', 1),    false],
  [{ role: 'ACCOUNTANT' }, M('REPLY', 1),           false],
  [{ role: 'APPLICANT', isApplicant: true }, M('PUBLIC_NOTE', 0),      true],
  [{ role: 'APPLICANT', isApplicant: true }, M('REJECTION_REASON', 1), false],
  [{ role: 'APPLICANT', isApplicant: true }, M('INTERNAL_REMARK', 1),  false],
  [{ role: 'CLERICAL' }, M('PUBLIC_NOTE', 0),       false],
  [{ role: 'SE', isApplicant: true }, M('PUBLIC_NOTE', 0), true], // staff-as-applicant keeps the staff view
];
for (const [viewer, msg, expected] of VIS) {
  test(`canReadMessage: ${viewer.role}${viewer.isApplicant ? '(applicant)' : ''} ${msg.kind}@${msg.visible_from_rank} -> ${expected}`, () => {
    assert.equal(canReadMessage(viewer, msg), expected);
  });
}

// ---- tender lifecycle (Phase 5) -------------------------------------------------------------------------
const publishData = { nit_number: 'NIT-1', portal_type: 'GeM', published_date: '2026-10-01', bid_end_date: '2026-10-20' };
const stageOf = (currentStatus, stage, payload = {}) => resolveTenderStage({ currentStatus, stage, payload });

test('tender transition table: every allowed move and what it writes', () => {
  const pub = stageOf(STATUS.APPROVED_FOR_TENDERING, 'PUBLISH', publishData);
  assert.deepEqual([pub.toStatus, pub.logAction], [STATUS.TENDER_PUBLISHED, 'TENDER_PUBLISHED']);
  assert.deepEqual([pub.tender.op, pub.tender.status, pub.tender.bid_end_date], ['insert', 'PUBLISHED', '2026-10-20']);
  // A cancelled tender may be published again: a new row, the cancelled one stays as history.
  assert.equal(stageOf(STATUS.TENDER_CANCELLED, 'PUBLISH', publishData).tender.op, 'insert');

  const tech = stageOf(STATUS.TENDER_PUBLISHED, 'TECHNICAL');
  assert.deepEqual([tech.toStatus, tech.logAction, tech.tender.status], [STATUS.TECHNICAL_EVALUATION, 'TECH_EVALUATION', 'TECHNICAL_EVALUATION']);
  const fin = stageOf(STATUS.TECHNICAL_EVALUATION, 'FINANCIAL');
  assert.deepEqual([fin.toStatus, fin.logAction], [STATUS.FINANCIAL_EVALUATION, 'FIN_EVALUATION']);

  const award = stageOf(STATUS.FINANCIAL_EVALUATION, 'AWARD', { awarded_agency: ' ABC Builders ', award_amount: '80000.50' });
  assert.deepEqual([award.toStatus, award.logAction], [STATUS.WORK_IN_PROGRESS, 'WORK_AWARDED']);
  assert.deepEqual([award.tender.status, award.tender.awarded_agency, award.tender.work_order_value], ['AWARDED', 'ABC Builders', 80000.5]);

  for (const from of [STATUS.TENDER_PUBLISHED, STATUS.TECHNICAL_EVALUATION, STATUS.FINANCIAL_EVALUATION]) {
    const c = stageOf(from, 'CANCEL', { reason: 'No bidders' });
    assert.deepEqual([c.toStatus, c.logAction, c.tender.status, c.tender.cancel_reason], [STATUS.TENDER_CANCELLED, 'TENDER_CANCELLED', 'CANCELLED', 'No bidders']);
  }
});

test('tender transition table: every refused move', () => {
  const allowed = {
    PUBLISH: [STATUS.APPROVED_FOR_TENDERING, STATUS.TENDER_CANCELLED],
    TECHNICAL: [STATUS.TENDER_PUBLISHED],
    FINANCIAL: [STATUS.TECHNICAL_EVALUATION],
    AWARD: [STATUS.FINANCIAL_EVALUATION],
    CANCEL: [STATUS.TENDER_PUBLISHED, STATUS.TECHNICAL_EVALUATION, STATUS.FINANCIAL_EVALUATION],
  };
  const complete = { ...publishData, awarded_agency: 'ABC', award_amount: 100, reason: 'r' };
  for (const stage of Object.values(TENDER_STAGES)) {
    for (const status of Object.values(STATUS)) {
      if (allowed[stage].includes(status)) continue;
      throwsCode(() => stageOf(status, stage, complete), 'STAGE_NOT_ALLOWED');
    }
  }
  // Awarding skips nothing: not from published, not from technical, no direct award from approval.
  throwsCode(() => stageOf(STATUS.APPROVED_FOR_TENDERING, 'AWARD', complete), 'STAGE_NOT_ALLOWED');
  throwsCode(() => stageOf(STATUS.TENDER_PUBLISHED, 'AWARD', complete), 'STAGE_NOT_ALLOWED');
  throwsCode(() => stageOf(STATUS.TECHNICAL_EVALUATION, 'AWARD', complete), 'STAGE_NOT_ALLOWED');
  throwsCode(() => stageOf(STATUS.TENDER_PUBLISHED, 'BANANA'), 'INVALID_STAGE');
  throwsCode(() => stageOf(STATUS.TENDER_PUBLISHED, undefined), 'INVALID_STAGE');
});

test('tender data gates: publish needs NIT, portal, both dates in order; award needs agency and a positive amount; cancel a reason', () => {
  const at = STATUS.APPROVED_FOR_TENDERING;
  throwsCode(() => stageOf(at, 'PUBLISH', { ...publishData, nit_number: '  ' }), 'NIT_REQUIRED');
  throwsCode(() => stageOf(at, 'PUBLISH', { ...publishData, portal_type: 'Newspaper' }), 'PORTAL_REQUIRED');
  throwsCode(() => stageOf(at, 'PUBLISH', { ...publishData, published_date: undefined }), 'CREATED_DATE_REQUIRED');
  throwsCode(() => stageOf(at, 'PUBLISH', { ...publishData, bid_end_date: '2026-13-40' }), 'END_DATE_REQUIRED');
  throwsCode(() => stageOf(at, 'PUBLISH', { ...publishData, bid_end_date: '2026-09-30' }), 'END_BEFORE_CREATED');
  assert.equal(stageOf(at, 'PUBLISH', { ...publishData, bid_end_date: '2026-10-01' }).toStatus, STATUS.TENDER_PUBLISHED); // same day is fine

  const f = STATUS.FINANCIAL_EVALUATION;
  throwsCode(() => stageOf(f, 'AWARD', { award_amount: 5 }), 'AGENCY_REQUIRED');
  for (const bad of [undefined, null, '', '  ', 'lots', NaN, Infinity]) {
    throwsCode(() => stageOf(f, 'AWARD', { awarded_agency: 'A', award_amount: bad }), 'AWARD_AMOUNT_REQUIRED');
  }
  for (const bad of [0, -5, '-1']) throwsCode(() => stageOf(f, 'AWARD', { awarded_agency: 'A', award_amount: bad }), 'AWARD_AMOUNT_INVALID');
  throwsCode(() => stageOf(f, 'AWARD', { awarded_agency: 'A', award_amount: MAX_AMOUNT + 1000 }), 'AWARD_AMOUNT_TOO_LARGE');
  assert.equal(stageOf(f, 'AWARD', { awarded_agency: 'A', award_amount: 150_000_000 }).tender.work_order_value, 150_000_000); // above the old 10 crore cap
  throwsCode(() => stageOf(STATUS.TENDER_PUBLISHED, 'CANCEL', { reason: ' ' }), 'REASON_REQUIRED');
});

test('the UI lists exactly the stages the rule allows, plus Resolve while open', () => {
  assert.deepEqual(tenderStagesFrom(STATUS.APPROVED_FOR_TENDERING), ['PUBLISH']);
  assert.deepEqual(tenderStagesFrom(STATUS.TENDER_PUBLISHED), ['TECHNICAL', 'CANCEL']);
  assert.deepEqual(tenderStagesFrom(STATUS.TECHNICAL_EVALUATION), ['FINANCIAL', 'CANCEL']);
  assert.deepEqual(tenderStagesFrom(STATUS.FINANCIAL_EVALUATION), ['AWARD', 'CANCEL']);
  assert.deepEqual(tenderStagesFrom(STATUS.TENDER_CANCELLED), ['PUBLISH']);
  assert.deepEqual(tenderStagesFrom(STATUS.WORK_IN_PROGRESS), []);
  assert.deepEqual(jeTenderActions(STATUS.TENDER_PUBLISHED).map((a) => a.action), ['TENDER_TECHNICAL', 'TENDER_CANCEL', 'RESOLVE']);
  assert.deepEqual(jeTenderActions(STATUS.ASSIGNED_TO_JE).map((a) => a.action), ['RESOLVE']);
  assert.deepEqual(jeTenderActions(STATUS.CLOSED), []);
});

test('resolve: any open status needs a note; closed, denied, unassigned and already-resolved are refused', () => {
  for (const status of Object.values(STATUS)) {
    if (canResolveFrom(status)) {
      const r = resolveResolution({ currentStatus: status, note: 'Done on site' });
      assert.deepEqual([r.toStatus, r.logAction, r.resolvedFrom], [STATUS.WORK_COMPLETED, 'RESOLVED', status]);
      throwsCode(() => resolveResolution({ currentStatus: status, note: '  ' }), 'NOTE_REQUIRED');
    } else {
      throwsCode(() => resolveResolution({ currentStatus: status, note: 'x' }), 'RESOLVE_NOT_ALLOWED');
    }
  }
  for (const s of [STATUS.CLOSED, STATUS.DENIED, STATUS.UNASSIGNED, STATUS.WORK_COMPLETED]) assert.equal(canResolveFrom(s), false, s);
  // Before approval it is flagged (digest + audit); inside the tender flow it is not.
  assert.equal(resolveResolution({ currentStatus: STATUS.PENDING_SE_APPROVAL, note: 'x' }).early, true);
  assert.equal(resolveResolution({ currentStatus: STATUS.ASSIGNED_TO_JE, note: 'x' }).early, true);
  assert.equal(resolveResolution({ currentStatus: STATUS.WORK_IN_PROGRESS, note: 'x' }).early, false);
  assert.equal(resolveResolution({ currentStatus: STATUS.TECHNICAL_EVALUATION, note: 'x' }).early, false);
});

test('applicant answer: close, or send back to where it was resolved from', () => {
  const at = STATUS.WORK_COMPLETED;
  assert.deepEqual(resolveCompletionCheck({ currentStatus: at, accepted: true }), { status: STATUS.CLOSED, logAction: 'CLOSED' });
  const back = (resolvedFrom, hasReport) =>
    resolveCompletionCheck({ currentStatus: at, accepted: false, remarks: 'Still leaks', resolvedFrom, hasReport });
  // Resolved inside the tender flow: back to that stage.
  for (const s of [STATUS.APPROVED_FOR_TENDERING, STATUS.TENDER_PUBLISHED, STATUS.TECHNICAL_EVALUATION,
    STATUS.FINANCIAL_EVALUATION, STATUS.TENDER_CANCELLED, STATUS.WORK_IN_PROGRESS]) {
    assert.deepEqual(back(s, true), { status: s, logAction: 'SENT_BACK' }, s);
  }
  // Resolved before approval: the JE inspection desk, "returned" when a report exists.
  assert.equal(back(STATUS.ASSIGNED_TO_JE, false).status, STATUS.ASSIGNED_TO_JE);
  assert.equal(back(STATUS.ASSIGNED_TO_JE, true).status, STATUS.RETURNED_TO_JE);
  assert.equal(back(STATUS.PENDING_AE_APPROVAL, true).status, STATUS.RETURNED_TO_JE);
  assert.equal(back(STATUS.RETURNED_TO_JE, true).status, STATUS.RETURNED_TO_JE);
  // A row resolved before this release has no record: it returns to work in progress, as before.
  assert.equal(back(null, false).status, STATUS.WORK_IN_PROGRESS);
  throwsCode(() => resolveCompletionCheck({ currentStatus: at, accepted: false, remarks: '  ' }), 'MESSAGE_REQUIRED');
  throwsCode(() => resolveCompletionCheck({ currentStatus: at, accepted: 'yes' }), 'VALIDATION_ERROR');
  throwsCode(() => resolveCompletionCheck({ currentStatus: STATUS.WORK_IN_PROGRESS, accepted: true }), 'NOT_COMPLETED_YET');
});
