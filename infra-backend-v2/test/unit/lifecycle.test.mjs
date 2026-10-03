// Pure rules of the post-approval lifecycle (Master plan, section 7): every (status, action, actor) pair.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS, LIFECYCLE, RESOLUTION, WorkflowError, resolveLifecycleAction, availableLifecycleActions,
  RESOLVABLE_STATUSES, TENDER_STAGES, POST_APPROVAL_STATUSES,
} from '../../src/config/workflow.js';

const JE = { id: 5, role: 'JE' };
const t = (status) => ({ status, assigned_je_id: 5 });
const run = (status, action, payload = {}, user = JE) => resolveLifecycleAction({ user, ticket: t(status), action, payload });
const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof WorkflowError, String(e)); return e.code; } return null; };

const PAYLOAD = {
  [LIFECYCLE.PUBLISH_TENDER]: { tender_created_date: '2026-10-01', tender_end_date: '2026-10-15' },
  [LIFECYCLE.AWARD]: { award_amount: '125000', awarded_agency: 'ABC Constructions' },
  [LIFECYCLE.CANCEL_TENDER]: { reason: 'No bids received' },
  [LIFECYCLE.RESOLVE]: { note: 'Closing out' },
};
const ALLOWED_FROM = {
  [LIFECYCLE.PUBLISH_TENDER]: [STATUS.APPROVED_FOR_TENDERING],
  [LIFECYCLE.START_TECHNICAL_EVAL]: [STATUS.TENDER_PUBLISHED],
  [LIFECYCLE.START_FINANCIAL_EVAL]: [STATUS.TECHNICAL_EVALUATION],
  [LIFECYCLE.AWARD]: [STATUS.FINANCIAL_EVALUATION],
  [LIFECYCLE.CANCEL_TENDER]: [STATUS.TENDER_PUBLISHED, STATUS.TECHNICAL_EVALUATION, STATUS.FINANCIAL_EVALUATION],
  [LIFECYCLE.RESOLVE]: RESOLVABLE_STATUSES,
};

test('every (status, action) pair: allowed exactly where the table says, 409 elsewhere', () => {
  for (const action of Object.values(LIFECYCLE)) {
    for (const status of Object.values(STATUS)) {
      const c = code(() => run(status, action, PAYLOAD[action]));
      if (ALLOWED_FROM[action].includes(status)) assert.equal(c, null, `${action} from ${status}`);
      else assert.equal(c, 'INVALID_TRANSITION', `${action} from ${status}`);
    }
  }
});

test('only the ticket\'s own JE may act; nobody else, not even another JE or a Sysadmin', () => {
  for (const user of [{ id: 6, role: 'JE' }, { id: 5, role: 'AE' }, { id: 5, role: 'SYSADMIN' }, { id: 5, role: 'APPLICANT' }]) {
    assert.equal(code(() => run(STATUS.APPROVED_FOR_TENDERING, LIFECYCLE.PUBLISH_TENDER, PAYLOAD.PUBLISH_TENDER, user)), 'NOT_YOUR_TICKET');
  }
  assert.equal(code(() => resolveLifecycleAction({ user: JE, ticket: { status: STATUS.WORK_IN_PROGRESS, assigned_je_id: null }, action: 'RESOLVE' })), 'NOT_YOUR_TICKET');
  assert.deepEqual(availableLifecycleActions({ user: { id: 6, role: 'JE' }, ticket: t(STATUS.WORK_IN_PROGRESS) }), []);
});

test('tender steps are sequential and carry no skipping', () => {
  assert.equal(run(STATUS.APPROVED_FOR_TENDERING, LIFECYCLE.PUBLISH_TENDER, PAYLOAD.PUBLISH_TENDER).toStatus, STATUS.TENDER_PUBLISHED);
  assert.equal(run(STATUS.TENDER_PUBLISHED, LIFECYCLE.START_TECHNICAL_EVAL).toStatus, STATUS.TECHNICAL_EVALUATION);
  assert.equal(run(STATUS.TECHNICAL_EVALUATION, LIFECYCLE.START_FINANCIAL_EVAL).toStatus, STATUS.FINANCIAL_EVALUATION);
  assert.equal(run(STATUS.FINANCIAL_EVALUATION, LIFECYCLE.AWARD, PAYLOAD.AWARD).toStatus, STATUS.WORK_IN_PROGRESS);
  // jumping from approval straight to award, or evaluation to award, is refused
  assert.equal(code(() => run(STATUS.APPROVED_FOR_TENDERING, LIFECYCLE.AWARD, PAYLOAD.AWARD)), 'INVALID_TRANSITION');
  assert.equal(code(() => run(STATUS.TECHNICAL_EVALUATION, LIFECYCLE.AWARD, PAYLOAD.AWARD)), 'INVALID_TRANSITION');
});

test('publish needs both dates, valid, end on or after start', () => {
  const p = (extra) => () => run(STATUS.APPROVED_FOR_TENDERING, LIFECYCLE.PUBLISH_TENDER, { ...PAYLOAD.PUBLISH_TENDER, ...extra });
  assert.equal(code(p({ tender_created_date: undefined })), 'INVALID_DATE');
  assert.equal(code(p({ tender_end_date: '' })), 'INVALID_DATE');
  assert.equal(code(p({ tender_end_date: '2026-02-30' })), 'INVALID_DATE');
  assert.equal(code(p({ tender_end_date: '2026-09-30' })), 'INVALID_DATE_RANGE');
  assert.equal(code(p({ tender_end_date: '2026-10-01' })), null, 'same day is fine');
  assert.equal(code(p({ portal_type: 'Newspaper' })), 'INVALID_PORTAL');
  assert.deepEqual(p({ nit_number: ' NIT/26/1 ' }) && run(STATUS.APPROVED_FOR_TENDERING, LIFECYCLE.PUBLISH_TENDER,
    { ...PAYLOAD.PUBLISH_TENDER, nit_number: ' NIT/26/1 ' }).tender,
  { tender_created_date: '2026-10-01', tender_end_date: '2026-10-15', portal_type: 'GeM', nit_number: 'NIT/26/1' });
});

test('award needs an amount above 0 and the agency', () => {
  const a = (extra) => () => run(STATUS.FINANCIAL_EVALUATION, LIFECYCLE.AWARD, { ...PAYLOAD.AWARD, ...extra });
  assert.equal(code(a({ award_amount: undefined })), 'AWARD_AMOUNT_REQUIRED');
  assert.equal(code(a({ award_amount: '' })), 'AWARD_AMOUNT_REQUIRED');
  assert.equal(code(a({ award_amount: 0 })), 'AWARD_AMOUNT_INVALID');
  assert.equal(code(a({ award_amount: -5 })), 'AWARD_AMOUNT_INVALID');
  assert.equal(code(a({ award_amount: 'lots' })), 'AWARD_AMOUNT_INVALID');
  assert.equal(code(a({ award_amount: 1e15 })), 'AWARD_AMOUNT_TOO_LARGE');
  assert.equal(code(a({ awarded_agency: '  ' })), 'AGENCY_REQUIRED');
  assert.equal(a({})().tender.award_amount, 125000);
});

test('cancel resolves the ticket as TENDER_CANCELLED with a mandatory reason; no re-tender', () => {
  for (const status of TENDER_STAGES) {
    const d = run(status, LIFECYCLE.CANCEL_TENDER, { reason: ' No bids ' });
    assert.equal(d.toStatus, STATUS.WORK_COMPLETED);
    assert.equal(d.resolution, RESOLUTION.TENDER_CANCELLED);
    assert.equal(d.logAction, 'TENDER_CANCELLED');
    assert.equal(d.note, 'No bids');
    assert.equal(code(() => run(status, LIFECYCLE.CANCEL_TENDER, { reason: '  ' })), 'REASON_REQUIRED');
  }
  assert.equal(code(() => run(STATUS.WORK_IN_PROGRESS, LIFECYCLE.CANCEL_TENDER, { reason: 'x' })), 'INVALID_TRANSITION');
  assert.equal(code(() => run(STATUS.WORK_COMPLETED, LIFECYCLE.PUBLISH_TENDER, PAYLOAD.PUBLISH_TENDER)), 'INVALID_TRANSITION');
});

test('resolve: from work in progress it is COMPLETED (note optional); from anywhere else a reason is required (OVERRIDE)', () => {
  const done = run(STATUS.WORK_IN_PROGRESS, LIFECYCLE.RESOLVE, {});
  assert.equal(done.resolution, RESOLUTION.COMPLETED);
  assert.equal(done.fromStatus, STATUS.WORK_IN_PROGRESS);
  for (const status of RESOLVABLE_STATUSES.filter((s) => s !== STATUS.WORK_IN_PROGRESS)) {
    assert.equal(code(() => run(status, LIFECYCLE.RESOLVE, {})), 'REASON_REQUIRED', status);
    const d = run(status, LIFECYCLE.RESOLVE, { note: 'Handled on site' });
    assert.equal(d.resolution, RESOLUTION.OVERRIDE);
    assert.equal(d.toStatus, STATUS.WORK_COMPLETED);
    assert.equal(d.fromStatus, status);
  }
  // never from: unassigned, already resolved, closed, denied
  for (const status of [STATUS.UNASSIGNED, STATUS.WORK_COMPLETED, STATUS.CLOSED, STATUS.DENIED]) {
    assert.equal(code(() => run(status, LIFECYCLE.RESOLVE, { note: 'x' })), 'INVALID_TRANSITION', status);
  }
  assert.equal(code(() => run(STATUS.WORK_IN_PROGRESS, LIFECYCLE.RESOLVE, { note: 'x'.repeat(2001) })), 'VALIDATION_ERROR');
});

test('availableLifecycleActions mirrors what the server accepts', () => {
  for (const status of Object.values(STATUS)) {
    const offered = availableLifecycleActions({ user: JE, ticket: t(status) }).map((a) => a.action).sort();
    const accepted = Object.values(LIFECYCLE).filter((action) => !code(() => run(status, action, PAYLOAD[action]))).sort();
    assert.deepEqual(offered, accepted, status);
  }
  const resolve = availableLifecycleActions({ user: JE, ticket: t(STATUS.PENDING_SE_APPROVAL) }).find((a) => a.action === 'RESOLVE');
  assert.deepEqual(resolve, { action: 'RESOLVE', resolution: 'OVERRIDE', requires: ['note'] });
});

test('status lists agree: post-approval list holds the tender stages and the resolve states', () => {
  for (const s of [...TENDER_STAGES, STATUS.WORK_IN_PROGRESS, STATUS.WORK_COMPLETED, STATUS.CLOSED]) {
    assert.ok(POST_APPROVAL_STATUSES.includes(s), s);
  }
});
