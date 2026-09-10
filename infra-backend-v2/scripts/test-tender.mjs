// Tests applyTenderUpdate against a MOCK connection: no MySQL, no network.
import { applyTenderUpdate } from '../src/controllers/ticketController.js';
import { STATUS } from '../src/config/workflow.js';

function mock({ selectRows = [], affectedRows = 1 } = {}) {
  const calls = [];
  return { calls,
    query: async (sql, params) => {
      // Keep the FULL statement, whitespace-normalised. Truncating it here
      // silently broke the `FOR UPDATE` assertion -- a bug in the harness,
      // not in the code under test.
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (/^SELECT/.test(sql.trim())) return [selectRows];
      if (/^UPDATE/.test(sql.trim())) return [{ affectedRows }];
      return [{ insertId: 1 }];
    } };
}
const ran = (c, frag) => c.calls.some(x => x.sql.includes(frag));

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); console.log(`  PASS  ${name}`); pass++; }
                               catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; } };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };
const rejects = async (p, code) => { try { await p; } catch (e) { eq(e.code, code, 'code'); return; }
                                     throw new Error(`expected ${code}, nothing thrown`); };

console.log('\n=== happy path ===');
await t('approved ticket + CLOSED -> commits and writes an audit row', async () => {
  const c = mock({ selectRows: [{ id: 7, status: STATUS.APPROVED_FOR_TENDERING }] });
  const next = await applyTenderUpdate(c, { ticketId: 7, jeId: 3, milestone: STATUS.CLOSED });
  eq(next, STATUS.CLOSED, 'next status');
  if (!ran(c, 'INSERT INTO audit_logs')) throw new Error('no audit row written');
  eq(c.calls.find(x => x.sql.includes('INSERT')).params[2], 'PASSED', 'audit action');
});

console.log('\n=== S1: the JE self-approve attack ===');
await t('JE posts APPROVED_FOR_TENDERING to an unapproved ticket', async () => {
  const c = mock({ selectRows: [{ id: 7, status: STATUS.ASSIGNED_TO_JE }] });
  await rejects(applyTenderUpdate(c, { ticketId: 7, jeId: 3, milestone: STATUS.APPROVED_FOR_TENDERING }), 'NOT_APPROVED_YET');
  if (ran(c, 'UPDATE tickets')) throw new Error('UPDATE issued -- should have been rejected first');
  if (ran(c, 'INSERT INTO audit_logs')) throw new Error('audit row written for a rejected action');
});
await t('JE posts garbage "BANANA" to an unapproved ticket', async () => {
  const c = mock({ selectRows: [{ id: 7, status: STATUS.ASSIGNED_TO_JE }] });
  await rejects(applyTenderUpdate(c, { ticketId: 7, jeId: 3, milestone: 'BANANA' }), 'NOT_APPROVED_YET');
});
await t('JE posts garbage "BANANA" to an APPROVED ticket', async () => {
  const c = mock({ selectRows: [{ id: 7, status: STATUS.APPROVED_FOR_TENDERING }] });
  await rejects(applyTenderUpdate(c, { ticketId: 7, jeId: 3, milestone: 'BANANA' }), 'INVALID_MILESTONE');
  if (ran(c, 'UPDATE tickets')) throw new Error('UPDATE issued for an invalid milestone');
});
await t('JE tries to close a ticket still sitting at the AE desk', async () => {
  const c = mock({ selectRows: [{ id: 7, status: STATUS.PENDING_AE_APPROVAL }] });
  await rejects(applyTenderUpdate(c, { ticketId: 7, jeId: 3, milestone: STATUS.CLOSED }), 'NOT_APPROVED_YET');
});

console.log('\n=== the "silent lie" bug: affectedRows was never checked ===');
await t('ticket belongs to a different JE -> 404, not a fake success', async () => {
  const c = mock({ selectRows: [] });
  await rejects(applyTenderUpdate(c, { ticketId: 999, jeId: 3, milestone: STATUS.CLOSED }), 'NOT_FOUND');
  if (ran(c, 'UPDATE tickets')) throw new Error('UPDATE issued for a ticket we do not own');
});
await t('concurrent edit: CAS affectedRows=0 -> 409, and NO audit row', async () => {
  const c = mock({ selectRows: [{ id: 7, status: STATUS.APPROVED_FOR_TENDERING }], affectedRows: 0 });
  await rejects(applyTenderUpdate(c, { ticketId: 7, jeId: 3, milestone: STATUS.CLOSED }), 'CONFLICT');
  if (ran(c, 'INSERT INTO audit_logs')) throw new Error('audit row written for a write that never happened');
});

console.log('\n=== ownership + locking ===');
await t('the locking SELECT binds assigned_je_id and uses FOR UPDATE', async () => {
  const c = mock({ selectRows: [{ id: 7, status: STATUS.APPROVED_FOR_TENDERING }] });
  await applyTenderUpdate(c, { ticketId: 7, jeId: 42, milestone: STATUS.CLOSED });
  eq(c.calls[0].params[1], 42, 'jeId bound into SELECT');
  if (!c.calls[0].sql.includes('FOR UPDATE')) throw new Error('row is not locked');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);