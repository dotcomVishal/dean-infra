// Master-plan Phase 5 over real HTTP: the JE drives publish -> technical -> financial -> award,
// cancel and re-publish, resolve at any stage, and the applicant closes or sends back.
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { call, stopServer, samplePdf } from './http-helpers.mjs';
import { TICKETS_DIR } from '../../src/config/paths.js';
import { makeUser, makeOpenTicket, cleanup, pool } from './helpers.mjs';

const ticketsToClean = [];
beforeEach(cleanup);
after(async () => {
  for (const id of ticketsToClean) fs.rmSync(path.join(TICKETS_DIR, String(id)), { recursive: true, force: true });
  await cleanup();
  await stopServer();
  await pool.end();
});

const uid = async (id) => (await pool.query('SELECT firebase_uid FROM mnt_users WHERE id = ?', [id]))[0][0].firebase_uid;
const row = async (id) => (await pool.query('SELECT * FROM mnt_tickets WHERE id = ?', [id]))[0][0];
const tenders = async (id) => (await pool.query('SELECT * FROM mnt_tenders WHERE ticket_id = ? ORDER BY id', [id]))[0];
const form = (fields, ...files) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  files.forEach((f) => fd.append('files', f));
  return fd;
};
const PUBLISH = { stage: 'PUBLISH', nit_number: 'NIT/2026/7', portal_type: 'GeM', published_date: '2026-10-01', bid_end_date: '2026-10-20' };

async function approvedTicket(status = 'APPROVED_FOR_TENDERING', estimate = 100) {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je = await makeUser({ role: 'JE' });
  const id = await makeOpenTicket(applicant, je, status);
  ticketsToClean.push(id);
  if (estimate != null) {
    await pool.query(
      "INSERT INTO mnt_reports (ticket_id, je_id, version, nature_of_work, estimated_amount) VALUES (?, ?, 1, 'ci work', ?)", [id, je, estimate]);
  }
  return { id, applicant, je, tokens: { je: await uid(je), applicant: await uid(applicant) } };
}

test('full walk: publish, technical, financial, award with files; every refusal on the way', async () => {
  const { id, je, tokens } = await approvedTicket();
  const stage = (fields, ...files) => call(tokens.je, 'POST', `/api/tickets/${id}/tender-stage`, form(fields, ...files));

  // Missing data: nothing moves.
  assert.equal((await stage({ stage: 'PUBLISH' })).body.code, 'CREATED_DATE_REQUIRED');
  assert.equal((await stage({ ...PUBLISH, bid_end_date: '2026-09-01' })).body.code, 'END_BEFORE_CREATED');
  assert.equal((await row(id)).status, 'APPROVED_FOR_TENDERING');

  const pub = await stage(PUBLISH, samplePdf('nit.pdf'));
  assert.equal(pub.status, 200, pub.text);
  assert.equal((await row(id)).status, 'TENDER_PUBLISHED');
  const [t1] = await tenders(id);
  assert.equal(t1.status, 'PUBLISHED');
  assert.equal(String(t1.bid_end_date).slice(0, 10) !== '', true);
  const [files] = await pool.query('SELECT uploader_desk, document_category, audit_log_id FROM mnt_attachments WHERE ticket_id = ?', [id]);
  assert.deepEqual(files.map((f) => [f.uploader_desk, f.document_category]), [['JE', 'CLERK_TENDER_DOC']]);
  assert.ok(files[0].audit_log_id);

  // Cannot skip ahead.
  assert.equal((await stage({ stage: 'AWARD', awarded_agency: 'A', award_amount: '80' })).body.code, 'STAGE_NOT_ALLOWED');
  assert.equal((await stage({ stage: 'FINANCIAL' })).status, 409);

  assert.equal((await stage({ stage: 'TECHNICAL' })).status, 200);
  assert.equal((await row(id)).status, 'TECHNICAL_EVALUATION');
  assert.equal((await stage({ stage: 'FINANCIAL' })).status, 200);
  assert.equal((await tenders(id))[0].status, 'FINANCIAL_EVALUATION');

  // Award needs an amount; a refusal leaves everything where it was.
  const noAmount = await stage({ stage: 'AWARD', awarded_agency: 'ABC Builders' });
  assert.equal(noAmount.status, 400);
  assert.equal(noAmount.body.code, 'AWARD_AMOUNT_REQUIRED');
  assert.equal((await row(id)).status, 'FINANCIAL_EVALUATION');

  const award = await stage({ stage: 'AWARD', awarded_agency: 'ABC Builders', award_amount: '80' });
  assert.equal(award.status, 200, award.text);
  assert.equal((await row(id)).status, 'WORK_IN_PROGRESS');
  const [t2] = await tenders(id);
  assert.deepEqual([t2.status, t2.awarded_agency, Number(t2.work_order_value)], ['AWARDED', 'ABC Builders', 80]);

  const actions = (await call(tokens.je, 'GET', `/api/tickets/${id}/details`)).body.ticket.available_actions.actions.map((a) => a.action);
  assert.deepEqual(actions, ['RESOLVE']);

  const log = (await pool.query('SELECT action FROM mnt_audit_logs WHERE ticket_id = ? ORDER BY id', [id]))[0].map((r) => r.action);
  assert.deepEqual(log, ['TENDER_PUBLISHED', 'TECH_EVALUATION', 'FIN_EVALUATION', 'WORK_AWARDED']);
  void je;
});

test('publish needs only the two dates; award needs only an amount; empty NIT is stored as NULL', async () => {
  const dates = { stage: 'PUBLISH', published_date: '2026-10-01', bid_end_date: '2026-10-20' };
  const a = await approvedTicket();
  const b = await approvedTicket();
  const stageOn = (t) => (fields) => call(t.tokens.je, 'POST', `/api/tickets/${t.id}/tender-stage`, form(fields));
  const sa = stageOn(a);
  const sb = stageOn(b);
  assert.equal((await sa(dates)).status, 200);
  // Two tenders with no NIT: the UNIQUE index must not refuse the second.
  assert.equal((await sb({ ...dates, nit_number: '  ' })).status, 200);
  assert.equal((await tenders(a.id))[0].nit_number, null);
  assert.equal((await tenders(b.id))[0].nit_number, null);

  assert.equal((await sa({ stage: 'TECHNICAL' })).status, 200);
  assert.equal((await sa({ stage: 'FINANCIAL' })).status, 200);
  const award = await sa({ stage: 'AWARD', award_amount: '75' });
  assert.equal(award.status, 200, award.text);
  const [t] = await tenders(a.id);
  assert.deepEqual([t.status, t.awarded_agency, Number(t.work_order_value)], ['AWARDED', null, 75]);
});

test('cancel needs a reason; a cancelled tender can be published again and keeps its history', async () => {
  const { id, tokens } = await approvedTicket();
  const stage = (fields) => call(tokens.je, 'POST', `/api/tickets/${id}/tender-stage`, form(fields));
  await stage(PUBLISH);
  assert.equal((await stage({ stage: 'CANCEL' })).body.code, 'REASON_REQUIRED');
  assert.equal((await stage({ stage: 'CANCEL', reason: 'No bidders' })).status, 200);
  assert.equal((await row(id)).status, 'TENDER_CANCELLED');
  assert.equal((await tenders(id))[0].cancel_reason, 'No bidders');

  assert.equal((await stage({ ...PUBLISH, nit_number: 'NIT/2026/8' })).status, 200);
  const all = await tenders(id);
  assert.deepEqual(all.map((t) => [t.nit_number, t.status]), [['NIT/2026/7', 'CANCELLED'], ['NIT/2026/8', 'PUBLISHED']]);
});

test('only the assigned JE drives the tender; Clerical and other JEs are refused', async () => {
  const { id, tokens } = await approvedTicket();
  const clerical = await uid(await makeUser({ role: 'CLERICAL' }));
  const otherJe = await uid(await makeUser({ role: 'JE' }));
  assert.equal((await call(clerical, 'POST', `/api/tickets/${id}/tender-stage`, form(PUBLISH))).status, 403);
  assert.equal((await call(otherJe, 'POST', `/api/tickets/${id}/tender-stage`, form(PUBLISH))).status, 404);
  assert.equal((await call(otherJe, 'POST', `/api/tickets/${id}/resolve`, { note: 'x' })).status, 404);
  assert.equal((await call(tokens.je, 'POST', `/api/tickets/${id}/tender-stage`, form(PUBLISH))).status, 200);
});

test('retired endpoints answer 410 for stale clients', async () => {
  const { id, tokens } = await approvedTicket();
  for (const p of ['tender', 'tenders', 'tenders/award']) {
    const r = await call(tokens.je, 'POST', `/api/tickets/${id}/${p}`, { milestone: 'TENDER_PUBLISHED' });
    assert.equal(r.status, 410, p);
    assert.equal(r.body.code, 'ENDPOINT_RETIRED');
  }
  assert.equal((await row(id)).status, 'APPROVED_FOR_TENDERING');
});

test('resolve at an open stage, then the applicant sends it back: lands where it was resolved from', async () => {
  const { id, je, applicant, tokens } = await approvedTicket('WORK_IN_PROGRESS');
  assert.equal((await call(tokens.je, 'POST', `/api/tickets/${id}/resolve`, { note: '  ' })).body.code, 'NOTE_REQUIRED');
  assert.equal((await call(tokens.je, 'POST', `/api/tickets/${id}/resolve`, { note: 'Finished' })).status, 200);
  let t = await row(id);
  assert.deepEqual([t.status, t.resolved_from_status, t.current_desk_user_id], ['WORK_COMPLETED', 'WORK_IN_PROGRESS', null]);
  assert.ok(t.resolved_at);
  assert.equal((await call(tokens.je, 'POST', `/api/tickets/${id}/resolve`, { note: 'again' })).status, 409);

  assert.equal((await call(tokens.applicant, 'POST', `/api/tickets/${id}/confirm-completion`, { accepted: false })).status, 400);
  const back = await call(tokens.applicant, 'POST', `/api/tickets/${id}/confirm-completion`, { accepted: false, remarks: 'Still leaks' });
  assert.equal(back.status, 200, back.text);
  t = await row(id);
  assert.deepEqual([t.status, t.resolved_from_status, t.current_desk_user_id], ['WORK_IN_PROGRESS', null, je]);
  void applicant;
});

test('resolved before approval and sent back: the JE inspection desk, JE reminded again', async () => {
  const { id, je, tokens } = await approvedTicket('ASSIGNED_TO_JE', null);
  await pool.query('UPDATE mnt_tickets SET current_desk_user_id = ? WHERE id = ?', [je, id]);
  const r = await call(tokens.je, 'POST', `/api/tickets/${id}/resolve`, { note: 'Not needed after all' });
  assert.equal(r.status, 200, r.text);
  const early = (await pool.query("SELECT remarks, visibility FROM mnt_audit_logs WHERE ticket_id = ? AND action = 'RESOLVED'", [id]))[0][0];
  assert.match(early.remarks, /^\[OVERRIDE\]/);
  assert.equal(early.visibility, 'INTERNAL');

  const back = await call(tokens.applicant, 'POST', `/api/tickets/${id}/confirm-completion`, { accepted: false, remarks: 'It is needed' });
  assert.equal(back.status, 200, back.text);
  const t = await row(id);
  assert.deepEqual([t.status, t.current_desk_user_id], ['ASSIGNED_TO_JE', je]);
  const live = (await pool.query("SELECT desk, to_user_id FROM mnt_notifications WHERE ticket_id = ? AND kind = 'REMINDER' AND status = 'PENDING'", [id]))[0];
  assert.deepEqual(live.map((x) => [x.desk, x.to_user_id]), [['JE', je]]);
});

test('closing clears the open change request', async () => {
  const { id, tokens } = await approvedTicket('WORK_IN_PROGRESS');
  await call(tokens.je, 'POST', `/api/tickets/${id}/resolve`, { note: 'Done' });
  assert.equal((await call(tokens.applicant, 'POST', `/api/tickets/${id}/confirm-completion`, { accepted: true })).status, 200);
  const t = await row(id);
  assert.deepEqual([t.status, t.open_change_request_id], ['CLOSED', null]);
});

test('statistics use the award amount: estimate 100, award 80 -> 80', async () => {
  const { id, tokens } = await approvedTicket();
  const admin = await uid(await makeUser({ role: 'SYSADMIN' }));
  const stage = (fields) => call(tokens.je, 'POST', `/api/tickets/${id}/tender-stage`, form(fields));
  await stage(PUBLISH); await stage({ stage: 'TECHNICAL' }); await stage({ stage: 'FINANCIAL' });
  await stage({ stage: 'AWARD', awarded_agency: 'ABC', award_amount: '80' });

  const list = await call(admin, 'GET', `/api/admin/tickets?search=${id}`);
  const mine = list.body.tickets.find((t) => t.id === id);
  assert.deepEqual([Number(mine.estimated_amount), Number(mine.awarded_amount), Number(mine.effective_amount)], [100, 80, 80]);

  const metrics = (await call(admin, 'GET', '/api/admin/metrics')).body.metrics;
  assert.ok(metrics.totalAwardedAmount >= 80);
  assert.ok(metrics.totalSanctionedAmount >= 80);
});

test('amounts above the old 10 crore cap are stored', async () => {
  const { id, tokens } = await approvedTicket();
  const stage = (fields) => call(tokens.je, 'POST', `/api/tickets/${id}/tender-stage`, form(fields));
  await stage(PUBLISH); await stage({ stage: 'TECHNICAL' }); await stage({ stage: 'FINANCIAL' });
  const r = await stage({ stage: 'AWARD', awarded_agency: 'Big Co', award_amount: '2500000000.50' });
  assert.equal(r.status, 200, r.text);
  assert.equal(Number((await tenders(id))[0].work_order_value), 2500000000.5);
});

test('Sysadmin override cannot force Awarded without an award; forcing Resolved records where it came from', async () => {
  const { id } = await approvedTicket('TENDER_PUBLISHED');
  const admin = await uid(await makeUser({ role: 'SYSADMIN' }));
  const force = (status) => call(admin, 'POST', `/api/admin/tickets/${id}/override`, { new_status: status, remarks: 'ci override' });

  const refused = await force('WORK_IN_PROGRESS');
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'AWARD_REQUIRED');
  assert.equal((await row(id)).status, 'TENDER_PUBLISHED');

  const ok = await force('WORK_COMPLETED');
  assert.equal(ok.status, 200, ok.text);
  const t = await row(id);
  assert.deepEqual([t.status, t.resolved_from_status], ['WORK_COMPLETED', 'TENDER_PUBLISHED']);
  assert.ok(t.resolved_at);
});
