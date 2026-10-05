// Bills: numeric validation, only on approved work, audit rows for every change,
// and a queue that says how many tickets match in all.
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { call, stopServer } from './http-helpers.mjs';
import { makeUser, makeOpenTicket, cleanup, pool } from './helpers.mjs';

beforeEach(cleanup);
after(async () => { await cleanup(); await stopServer(); await pool.end(); });

const uid = async (id) => (await pool.query('SELECT firebase_uid FROM users WHERE id = ?', [id]))[0][0].firebase_uid;
const good = { bill_number: 'RA-1', agency_name: 'ABC Builders', gross_amount: '1000', deductions: '100', net_amount: '900' };

async function setup(status = 'WORK_IN_PROGRESS') {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je = await makeUser({ role: 'JE' });
  const accountant = await makeUser({ role: 'ACCOUNTANT' });
  const id = await makeOpenTicket(applicant, je, status);
  return { id, token: await uid(accountant) };
}
const audit = async (id) => (await pool.query('SELECT action FROM audit_logs WHERE ticket_id = ? ORDER BY id', [id]))[0].map((r) => r.action);

test('a valid bill is stored with an audit row; bad numbers are refused with nothing written', async () => {
  const { id, token } = await setup();
  const post = (body) => call(token, 'POST', `/api/tickets/${id}/bills`, body);

  for (const bad of [
    { ...good, gross_amount: 'lots' }, { ...good, net_amount: '-5' }, { ...good, deductions: 'x' },
    { ...good, gross_amount: undefined }, { ...good, net_amount: '99999999999999999999' },
    { ...good, bill_number: '  ' }, { ...good, bill_type: 'GIFT' }, { ...good, payment_status: 'MAYBE' },
  ]) {
    const r = await post(bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM bills WHERE ticket_id = ?', [id]))[0][0].n), 0);
  assert.deepEqual(await audit(id), []);

  const ok = await post({ ...good, gross_amount: '2500000000.75', net_amount: '2400000000.25' }); // above the old cap
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(await audit(id), ['BILL_RECORDED']);
  assert.equal(Number((await pool.query('SELECT gross_amount g FROM bills WHERE id = ?', [ok.body.bill_id]))[0][0].g), 2500000000.75);
});

test('bills are refused on a ticket that is not approved yet, and on a missing ticket', async () => {
  const early = await setup('PENDING_SE_APPROVAL');
  const r = await call(early.token, 'POST', `/api/tickets/${early.id}/bills`, good);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'BILL_NOT_ALLOWED');
  assert.equal((await call(early.token, 'POST', '/api/tickets/999999999/bills', good)).status, 404);
});

test('updating a bill checks the value, writes BILL_UPDATED, and 404s on a missing bill', async () => {
  const { id, token } = await setup();
  const made = await call(token, 'POST', `/api/tickets/${id}/bills`, good);
  const patch = (billId, body) => call(token, 'PATCH', `/api/tickets/bills/${billId}`, body);

  assert.equal((await patch(made.body.bill_id, { payment_status: 'PAID' })).status, 400);
  assert.equal((await patch(made.body.bill_id, {})).status, 400);
  assert.equal((await patch(999999999, { payment_status: 'VERIFIED' })).status, 404);
  const ok = await patch(made.body.bill_id, { payment_status: 'DISBURSED', voucher_number: 'V-9', payment_date: '2026-10-05' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.bill.payment_status, 'DISBURSED');
  assert.deepEqual(await audit(id), ['BILL_RECORDED', 'BILL_UPDATED']);
});

test('the queue says how many tickets match in all, and the page size is capped', async () => {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je = await makeUser({ role: 'JE' });
  const admin = await makeUser({ role: 'SYSADMIN' });
  const ids = [];
  for (let i = 0; i < 3; i += 1) {
    const id = await makeOpenTicket(applicant, je, 'APPROVED_FOR_TENDERING');
    await pool.query("UPDATE tickets SET title = 'ci-queue-total' WHERE id = ?", [id]);
    ids.push(id);
  }
  const r = await call(await uid(admin), 'GET', '/api/tickets/queue?limit=2&search=ci-queue-total');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.tickets.length, 2);
  assert.equal(r.body.total, 3);
  assert.equal(r.body.limit, 2);
  const big = await call(await uid(admin), 'GET', '/api/tickets/queue?limit=100000');
  assert.equal(big.body.limit, 200);
});
