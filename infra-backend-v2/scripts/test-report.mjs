// Tests applyReportSubmission against a MOCK connection: no MySQL, no network.
import { applyReportSubmission } from '../src/controllers/ticketController.js';
import { STATUS, ROLE } from '../src/config/workflow.js';

function mock({ selectRows = [], affectedRows = 1 } = {}) {
  const calls = [];
  return { calls,
    query: async (sql, params) => {
      const norm = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: norm, params });
      if (norm.startsWith('SELECT')) return [selectRows];
      if (norm.startsWith('UPDATE')) return [{ affectedRows }];
      if (norm.startsWith('INSERT INTO reports')) return [{ insertId: 55 }];
      return [{ insertId: 1 }];
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
  eq(args(c, 'INSERT INTO reports')[3], 18500, 'estimate stored');
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
  const c = mock(atJE);
  await applyReportSubmission(c, { ...good, jeId: 42 });
  eq(c.calls[0].params[1], 42, 'jeId bound into SELECT');
  if (!c.calls[0].sql.includes('FOR UPDATE')) throw new Error('row is not locked');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);