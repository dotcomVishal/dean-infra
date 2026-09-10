import { resolveTransition, resolveTenderUpdate, STATUS, ROLE, WorkflowError }
  from '../src/config/workflow.js';

let pass = 0, fail = 0;
const ok  = (name, fn) => { try { fn(); console.log(`  PASS  ${name}`); pass++; }
                            catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; } };
const eq  = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const throws = (fn, code) => {
  try { fn(); } catch (e) {
    if (!(e instanceof WorkflowError)) throw e;
    eq(e.code, code, 'error code'); return;
  }
  throw new Error(`expected WorkflowError(${code}), but nothing was thrown`);
};

console.log('\n=== The happy path: JE -> AE -> SE -> Dean -> Director ===');
ok('JE submits a report -> goes to AE', () =>
  eq(resolveTransition({ currentStatus: STATUS.ASSIGNED_TO_JE, role: ROLE.JE,
       action: 'SUBMIT_REPORT', estimate: 20000 }).status, STATUS.PENDING_AE_APPROVAL, 'status'));

ok('AE approves Rs.20,000 (under ceiling) -> sanctioned', () =>
  eq(resolveTransition({ currentStatus: STATUS.PENDING_AE_APPROVAL, role: ROLE.AE,
       action: 'APPROVE', estimate: 20000 }).status, STATUS.APPROVED_FOR_TENDERING, 'status'));

ok('AE approves Rs.4,00,000 (over ceiling) -> escalates to SE', () =>
  eq(resolveTransition({ currentStatus: STATUS.PENDING_AE_APPROVAL, role: ROLE.AE,
       action: 'APPROVE', estimate: 400000 }).status, STATUS.PENDING_SE_APPROVAL, 'status'));

ok('Director approves anything -> sanctioned', () =>
  eq(resolveTransition({ currentStatus: STATUS.PENDING_DIRECTOR_APPROVAL, role: ROLE.DIRECTOR,
       action: 'APPROVE', estimate: 99999999 }).status, STATUS.APPROVED_FOR_TENDERING, 'status'));

console.log('\n=== The loopholes this closes ===');
ok('S1: JE can NO LONGER self-approve', () =>
  throws(() => resolveTenderUpdate({ currentStatus: STATUS.ASSIGNED_TO_JE,
         milestone: STATUS.APPROVED_FOR_TENDERING }), 'NOT_APPROVED_YET'));

ok('S1: JE cannot set an arbitrary status string', () =>
  throws(() => resolveTenderUpdate({ currentStatus: STATUS.APPROVED_FOR_TENDERING,
         milestone: 'BANANA' }), 'INVALID_MILESTONE'));

ok('S1: JE cannot close an unapproved ticket', () =>
  throws(() => resolveTenderUpdate({ currentStatus: STATUS.ASSIGNED_TO_JE,
         milestone: STATUS.CLOSED }), 'NOT_APPROVED_YET'));

ok('no state-machine guard: DIRECTOR cannot skip the JE inspection', () =>
  throws(() => resolveTransition({ currentStatus: STATUS.ASSIGNED_TO_JE, role: ROLE.DIRECTOR,
         action: 'APPROVE', estimate: 5000 }), 'NOT_YOUR_DESK'));

ok("no state-machine guard: AE cannot act on the Dean's desk", () =>
  throws(() => resolveTransition({ currentStatus: STATUS.PENDING_DEAN_APPROVAL, role: ROLE.AE,
         action: 'APPROVE', estimate: 5000 }), 'NOT_YOUR_DESK'));

ok('NaN bug: no estimate on file -> hard fail, not silent escalation', () =>
  throws(() => resolveTransition({ currentStatus: STATUS.PENDING_SE_APPROVAL, role: ROLE.SE,
         action: 'APPROVE', estimate: null }), 'ESTIMATE_MISSING'));

ok('v1 DENY bug: AE denying -> clean 403, not a 500', () =>
  throws(() => resolveTransition({ currentStatus: STATUS.PENDING_AE_APPROVAL, role: ROLE.AE,
         action: 'DENY', estimate: 5000 }), 'DENY_NOT_ALLOWED'));

ok('RETURN sends it back to the JE', () =>
  eq(resolveTransition({ currentStatus: STATUS.PENDING_DEAN_APPROVAL, role: ROLE.DEAN,
       action: 'RETURN', estimate: 900000 }).status, STATUS.RETURNED_TO_JE, 'status'));

ok('B6: a returned ticket can be re-filed (no more dead end)', () =>
  eq(resolveTransition({ currentStatus: STATUS.RETURNED_TO_JE, role: ROLE.JE,
       action: 'SUBMIT_REPORT', estimate: 30000 }).status, STATUS.PENDING_AE_APPROVAL, 'status'));

ok('JE cannot RETURN their own ticket (self-loop + bogus audit entry)', () =>
  throws(() => resolveTransition({ currentStatus: STATUS.ASSIGNED_TO_JE, role: ROLE.JE,
         action: 'RETURN', estimate: null }), 'JE_ACTION_NOT_ALLOWED'));

ok('JE cannot APPROVE (was a confusing NO_HIGHER_AUTHORITY)', () =>
  throws(() => resolveTransition({ currentStatus: STATUS.ASSIGNED_TO_JE, role: ROLE.JE,
         action: 'APPROVE', estimate: 5000 }), 'JE_ACTION_NOT_ALLOWED'));

ok('JE cannot re-file a report on an already-approved ticket', () =>
  throws(() => resolveTransition({ currentStatus: STATUS.APPROVED_FOR_TENDERING, role: ROLE.JE,
         action: 'SUBMIT_REPORT', estimate: 5000 }), 'REPORT_NOT_ALLOWED'));

ok('a DEAN cannot act on a ticket already past approval', () =>
  throws(() => resolveTransition({ currentStatus: STATUS.APPROVED_FOR_TENDERING, role: ROLE.DEAN,
         action: 'RETURN', estimate: 5000 }), 'NOT_YOUR_DESK'));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);