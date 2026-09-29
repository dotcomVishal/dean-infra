// Tests applyReportSubmission against a MOCK connection: no MySQL, no network.
import { applyReportSubmission } from '../src/controllers/ticketController.js';
import { STATUS, ROLE } from '../src/config/workflow.js';

// Routes each query by shape so the mock survives new SELECTs being added:
//   ticket lock -> selectRows[0]; ticket_messages -> `messages`; MAX(version) -> nextVersion;
//   any users lookup (desk owner) -> an active AE; INSERTs return ids.
function mock({ selectRows = [], affectedRows = 1, messages = [], nextVersion = 1 } = {}) {
  const calls = [];
  return { calls,
    query: async (sql, params) => {
      const norm = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: norm, params });
      if (norm.includes('FROM tickets')) return [selectRows.map(r => ({ assigned_je_id: 3, department: 'Civil', campus: 'NORTH', current_desk_user_id: null, open_change_request_id: null, ...r }))];
      if (norm.includes('FROM ticket_messages')) return [messages];
      if (norm.includes('MAX(version)')) return [[{ next: nextVersion }]];
      if (norm.includes('FROM users')) return [[{ id: 20, name: 'AE Person', email: 'ae@campus.edu' }]];
      if (norm.startsWith('UPDATE')) return [{ affectedRows }];
      if (norm.startsWith('INSERT INTO reports')) return [{ insertId: 55 }];
      if (norm.startsWith('INSERT INTO audit_logs')) return [{ insertId: 66 }];
      return [{ insertId: 77 }];
    } };
}
const ran  = (c, frag) => c.calls.some(x => x.sql.includes(frag));
const args = (c, frag) => c.calls.find(x => x.sql.includes(frag))?.params;

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); console.log(`  PASS  ${name}`); pass++; }
                               catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };
const rejects = async (p, code) => { try { await p; } catch (e) { eq(e.code, code, 'code'); return; }
                                     throw new Error(`expected ${code}, nothing thrown`); };
const atJE = { selectRows: [{ id: 7, status: STATUS.ASSIGNED_TO_JE }] };
const good = { ticketId: 7, jeId: 3, role: ROLE.JE, natureOfWork: 'Replace 40W tube lights, 12 nos.', estimate: 18500 };

console.log('\n=== happy path ===');
await t('JE files a report -> report row + status to AE + audit SUBMITTED', async () => {
  const c = mock(atJE);
  const out = await applyReportSubmission(c, good);
  eq(out.nextStatus, STATUS.PENDING_AE_APPROVAL, 'next status');
  eq(out.reportId, 55, 'report id returned');
  if (!ran(c, 'INSERT INTO reports')) throw new Error('no report row written');
  eq(args(c, 'INSERT INTO reports')[4], 18500, 'estimate stored');
  eq(args(c, 'INSERT INTO reports')[2], 1, 'first report is version 1');
  eq(args(c, 'INSERT INTO audit_logs')[2], 'SUBMITTED', 'audit action');
});
await t('B6: a RETURNED ticket can be re-filed', async () => {
  const c = mock({ selectRows: [{ id: 7, status: STATUS.RETURNED_TO_JE }] });
  const out = await applyReportSubmission(c, good);
  eq(out.nextStatus, STATUS.PENDING_AE_APPROVAL, 'next status');
});
await t('re-filing keeps history: a second report row is INSERTed, not updated', async () => {
  const c = mock({ selectRows: [{ id: 7, status: STATUS.RETURNED_TO_JE }] });
  await applyReportSubmission(c, good);
  eq(c.calls.filter(x => x.sql.startsWith('INSERT INTO reports')).length, 1, 'insert count');
  if (ran(c, 'UPDATE reports')) throw new Error('overwrote the previous report');
});

console.log('\n=== versioning + change requests (plan.md Phase 4 item 4) ===');
await t('re-filed report gets the NEXT version number', async () => {
  const c = mock({ selectRows: [{ id: 7, status: STATUS.RETURNED_TO_JE }], nextVersion: 3 });
  await applyReportSubmission(c, good);
  eq(args(c, 'INSERT INTO reports')[2], 3, 'version');
});
await t('a report answering a change request links answers_message_id and writes a REPLY', async () => {
  const c = mock({
    selectRows: [{ id: 7, status: STATUS.RETURNED_TO_JE, open_change_request_id: 9 }],
    messages: [{ id: 9, ticket_id: 7, author_desk: 'AE', to_desk: 'JE', kind: 'CHANGE_REQUEST', in_reply_to: null }],
    nextVersion: 2,
  });
  await applyReportSubmission(c, { ...good, remarks: 'Replaced the breaker as asked.' });
  const reportArgs = args(c, 'INSERT INTO reports');
  eq(reportArgs[6], 9, 'answers_message_id');
  eq(reportArgs[5], 'Replaced the breaker as asked.', 'remarks stored on the report');
  const msg = args(c, 'INSERT INTO ticket_messages');
  eq(msg[6], 'REPLY', 'reply kind');
  eq(msg[9], 9, 'in_reply_to');
});
await t('answering a change request WITHOUT remarks is refused, nothing written', async () => {
  const c = mock({
    selectRows: [{ id: 7, status: STATUS.RETURNED_TO_JE, open_change_request_id: 9 }],
    messages: [{ id: 9, ticket_id: 7, author_desk: 'AE', to_desk: 'JE', kind: 'CHANGE_REQUEST', in_reply_to: null }],
  });
  await rejects(applyReportSubmission(c, good), 'MESSAGE_REQUIRED');
  if (ran(c, 'INSERT INTO reports')) throw new Error('report written without the mandatory reply');
});
await t('a first report (no open request) has answers_message_id NULL and writes no message', async () => {
  const c = mock(atJE);
  await applyReportSubmission(c, good);
  eq(args(c, 'INSERT INTO reports')[6], null, 'answers_message_id');
  if (ran(c, 'INSERT INTO ticket_messages')) throw new Error('unexpected message');
});
await t('ticket lands on the AE desk person', async () => {
  const c = mock(atJE);
  await applyReportSubmission(c, good);
  const up = c.calls.find(x => x.sql.startsWith('UPDATE tickets'));
  eq(up.params[0], STATUS.PENDING_AE_APPROVAL, 'to status');
  eq(up.params[1], 20, 'current_desk_user_id = resolved AE');
});

console.log('\n=== validation ===');
await t('missing nature_of_work -> 400, nothing written', async () => {
  const c = mock(atJE);
  await rejects(applyReportSubmission(c, { ...good, natureOfWork: '   ' }), 'NATURE_OF_WORK_REQUIRED');
  if (ran(c, 'INSERT INTO reports')) throw new Error('report row written for an invalid submission');
});
await t('missing estimate -> ESTIMATE_REQUIRED (the v1 NaN bug)', async () => {
  const c = mock(atJE);
  await rejects(applyReportSubmission(c, { ...good, estimate: undefined }), 'ESTIMATE_REQUIRED');
});
await t('null estimate -> ESTIMATE_REQUIRED', async () => {
  const c = mock(atJE);
  await rejects(applyReportSubmission(c, { ...good, estimate: null }), 'ESTIMATE_REQUIRED');
});
await t('negative estimate -> ESTIMATE_INVALID', async () => {
  const c = mock(atJE);
  await rejects(applyReportSubmission(c, { ...good, estimate: -500 }), 'ESTIMATE_INVALID');
});
await t('estimate over DECIMAL(10,2) -> ESTIMATE_TOO_LARGE', async () => {
  const c = mock(atJE);
  await rejects(applyReportSubmission(c, { ...good, estimate: 1e12 }), 'ESTIMATE_TOO_LARGE');
});
await t('non-numeric estimate string -> ESTIMATE_INVALID, not "too large"', async () => {
  const c = mock(atJE);
  await rejects(applyReportSubmission(c, { ...good, estimate: 'lots' }), 'ESTIMATE_INVALID');
});
await t('empty-string estimate -> ESTIMATE_REQUIRED (Number("") is 0!)', async () => {
  const c = mock(atJE);
  await rejects(applyReportSubmission(c, { ...good, estimate: '' }), 'ESTIMATE_REQUIRED');
});
await t('a Rs.0 estimate cannot be filed (would auto-sanction)', async () => {
  const c = mock(atJE);
  await rejects(applyReportSubmission(c, { ...good, estimate: 0 }), 'ESTIMATE_INVALID');
});

console.log('\n=== authorisation ===');
await t('JE does not own the ticket -> 404, nothing written', async () => {
  const c = mock({ selectRows: [] });
  await rejects(applyReportSubmission(c, good), 'NOT_FOUND');
  if (ran(c, 'INSERT INTO reports')) throw new Error('report written for a ticket we do not own');
});
await t('role is checked by the state machine, NOT assumed from the route', async () => {
  const c = mock(atJE);
  await rejects(applyReportSubmission(c, { ...good, role: ROLE.APPLICANT }), 'NOT_YOUR_DESK');
  if (ran(c, 'INSERT INTO reports')) throw new Error('an APPLICANT filed a JE report');
});
await t('JE cannot re-file onto a ticket already at the AE desk', async () => {
  const c = mock({ selectRows: [{ id: 7, status: STATUS.PENDING_AE_APPROVAL }] });
  await rejects(applyReportSubmission(c, good), 'NOT_YOUR_DESK');
});
// The JE DOES own an approved ticket (it drives tender milestones), so Rule 0
// passes and the more specific REPORT_NOT_ALLOWED guard fires instead.
await t('JE cannot re-file onto an already-approved ticket', async () => {
  const c = mock({ selectRows: [{ id: 7, status: STATUS.APPROVED_FOR_TENDERING }] });
  await rejects(applyReportSubmission(c, good), 'REPORT_NOT_ALLOWED');
});

console.log('\n=== concurrency ===');
await t('CAS affectedRows=0 -> 409 and NO audit row', async () => {
  const c = mock({ ...atJE, affectedRows: 0 });
  await rejects(applyReportSubmission(c, good), 'CONFLICT');
  if (ran(c, 'INSERT INTO audit_logs')) throw new Error('audit row written for a write that never happened');
});
await t('the locking SELECT binds assigned_je_id and uses FOR UPDATE', async () => {
  const c = mock({ selectRows: [{ id: 7, status: STATUS.ASSIGNED_TO_JE, assigned_je_id: 42 }] });
  await applyReportSubmission(c, { ...good, jeId: 42 });
  eq(c.calls[0].params[1], 42, 'jeId bound into SELECT');
  if (!c.calls[0].sql.includes('FOR UPDATE')) throw new Error('row is not locked');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);