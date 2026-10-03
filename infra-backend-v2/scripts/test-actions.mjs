// Integration test for Phase 4: POST /tickets/:id/actions, message threading,
// visible_from_rank, report versioning and the audit vocabulary -- against a
// live DB (migrations 001-005 applied, scripts/seed-staff.mjs run). Drives the
// real controllers with fake req/res (no Firebase). Self-cleaning.
//
//   node scripts/test-actions.mjs
import 'dotenv/config';
import '../src/config/requireTestDb.js';
import pool from '../src/config/db.js';
import { performTicketAction } from '../src/controllers/actionController.js';
import { applyReportSubmission } from '../src/controllers/ticketController.js';
import { findDeskOwner } from '../src/models/deskModel.js';
import { listForTicket } from '../src/models/messageModel.js';
import { canReadMessage } from '../src/config/workflow.js';

let pass = 0, fail = 0;
async function ok(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const one = async (sql, params) => (await pool.query(sql, params))[0][0];

function fakeRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
async function act(user, ticketId, body) {
  const res = fakeRes();
  await performTicketAction({ user, params: { ticket_id: String(ticketId) }, body }, res);
  return res;
}
async function fileReport(user, ticketId, remarks) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await applyReportSubmission(conn, {
      ticketId, jeId: user.id, role: user.role, natureOfWork: 'Replace corroded pipe run',
      estimate: 120000, remarks,
    });
    await conn.commit();
    return out;
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}
const statusOf = async (id) => (await one('SELECT status, current_desk_user_id, open_change_request_id FROM infra_tickets WHERE id = ?', [id]));

const created = [];
async function run() {
  console.log('\n=== Phase 4: actions, threading, versioning, audit (live DB) ===');

  const deepak = await one("SELECT id, name, email, role FROM infra_users WHERE email = 'deepak.chauhan@campus.edu'");
  const kapil = await one("SELECT id, name, email, role FROM infra_users WHERE email = 'kapil.verma@campus.edu'");
  const neeraj = await one("SELECT id, name, email, role FROM infra_users WHERE email = 'neeraj.chauhan@campus.edu'");
  const applicant = await one("SELECT id FROM infra_users WHERE role = 'APPLICANT' ORDER BY id LIMIT 1");
  if (!deepak || !kapil || !neeraj) throw new Error('Run scripts/seed-staff.mjs first.');
  const T = { department: 'Civil', campus: 'NORTH', assigned_je_id: deepak.id };
  const owner = async (desk) => {
    const p = await findDeskOwner(pool, T, desk);
    return one('SELECT id, name, email, role FROM infra_users WHERE id = ?', [p.id]);
  };
  const ae = await owner('AE'), se = await owner('SE'), dean = await owner('DEAN'), dir = await owner('DIRECTOR');

  const [ins] = await pool.query(
    `INSERT INTO infra_tickets (applicant_id, assigned_je_id, current_desk_user_id, department, campus, title, description, landmark, status)
     VALUES (?, ?, ?, 'Civil', 'NORTH', 'Phase4 test', 'desc', 'loc', 'ASSIGNED_TO_JE')`,
    [applicant.id, deepak.id, deepak.id]
  );
  const id = ins.insertId;
  created.push(id);

  await ok('JE files report v1 -> AE desk person, version 1', async () => {
    const out = await fileReport(deepak, id, null);
    eq(out.version, 1, 'version');
    const t = await statusOf(id);
    eq(t.status, 'PENDING_AE_APPROVAL', 'status');
    eq(t.current_desk_user_id, ae.id, 'desk person is the scope AE');
  });

  await ok('wrong person at the right role is refused (Electrical AE on a Civil ticket)', async () => {
    const r = await act(neeraj, id, { action: 'FORWARD' });
    eq(r.statusCode, 403, 'http'); eq(r.body.code, 'NOT_YOUR_DESK', 'code');
  });
  await ok('AE cannot APPROVE (Q1)', async () => {
    const r = await act(ae, id, { action: 'APPROVE' });
    eq(r.statusCode, 403, 'http'); eq(r.body.code, 'ACTION_NOT_ALLOWED', 'code');
  });
  await ok('zod: unknown key, missing to_desk, ASSIGN_JE without assignee -> 400 before any DB work', async () => {
    eq((await act(ae, id, { action: 'FORWARD', hack: 1 })).statusCode, 400, 'unknown key');
    eq((await act(ae, id, { action: 'REQUEST_CHANGES', message: 'x' })).statusCode, 400, 'no to_desk');
    eq((await act(ae, id, { action: 'ASSIGN_JE' })).statusCode, 400, 'no assignee');
    eq((await act(ae, id, { action: 'DELETE' })).statusCode, 400, 'bad action');
  });

  await ok('AE FORWARD -> SE; SE APPROVE above limit is refused (forced forward)', async () => {
    eq((await act(ae, id, { action: 'FORWARD' })).body.status, 'PENDING_SE_APPROVAL', 'to SE');
    const r = await act(se, id, { action: 'APPROVE' });
    eq(r.statusCode, 409, 'http'); eq(r.body.code, 'ABOVE_LIMIT', 'code');
  });
  await ok('SE FORWARD -> Dean; Dean FORWARD -> Director (limit is 5 lakh, estimate 1.2 lakh, forward still allowed)', async () => {
    eq((await act(se, id, { action: 'FORWARD' })).body.status, 'PENDING_DEAN_APPROVAL', 'to Dean');
    eq((await act(dean, id, { action: 'FORWARD' })).body.status, 'PENDING_DIRECTOR_APPROVAL', 'to Director');
  });

  let m1, m2;
  await ok('Director REQUEST_CHANGES -> SE: message + internal remark, open request set', async () => {
    const r = await act(dir, id, { action: 'REQUEST_CHANGES', to_desk: 'SE', message: 'Justify the rate.', internal_remark: 'Watch this contractor.' });
    eq(r.statusCode, 200, 'http'); eq(r.body.status, 'PENDING_SE_APPROVAL', 'status');
    eq(r.body.current_desk_user_id, se.id, 'ticket sits with the SE person');
    m1 = r.body.open_change_request_id;
    const msgs = (await pool.query('SELECT kind, visible_from_rank, to_desk, to_user_id, in_reply_to FROM infra_ticket_messages WHERE ticket_id = ? ORDER BY id', [id]))[0];
    eq(msgs.length, 2, 'two message rows');
    const cr = msgs.find((x) => x.kind === 'CHANGE_REQUEST');
    eq(cr.visible_from_rank, 3, 'CHANGE_REQUEST rank = recipient (SE)'); eq(cr.to_user_id, se.id, 'to_user_id resolved');
    eq(msgs.find((x) => x.kind === 'INTERNAL_REMARK').visible_from_rank, 5, 'INTERNAL_REMARK rank = author (Director)');
  });
  await ok('Director cannot send changes upward / to a desk not below it', async () => {
    eq((await act(se, id, { action: 'REQUEST_CHANGES', to_desk: 'DEAN', message: 'x' })).body.code, 'INVALID_TARGET_DESK', 'SE -> Dean');
  });
  await ok('SE passes the request down to the JE; threads with in_reply_to', async () => {
    const r = await act(se, id, { action: 'REQUEST_CHANGES', to_desk: 'JE', message: 'Redo the estimate with rate analysis.' });
    eq(r.body.status, 'RETURNED_TO_JE', 'status'); eq(r.body.current_desk_user_id, deepak.id, 'ticket at assigned JE');
    m2 = r.body.open_change_request_id;
    const row = await one('SELECT in_reply_to FROM infra_ticket_messages WHERE id = ?', [m2]);
    eq(row.in_reply_to, m1, 'linked to the Director request');
    eq(m2 === m1, false, 'new thread head');
  });

  await ok('visible_from_rank: JE reads only the request addressed to it; AE sees SE->JE but not the Director\'s', async () => {
    const all = await listForTicket(pool, id);
    const seen = (role) => all.filter((m) => canReadMessage({ role }, m)).map((m) => m.id);
    const directorInternal = all.find((m) => m.kind === 'INTERNAL_REMARK').id;
    eq(JSON.stringify(seen('JE')), JSON.stringify([m2]), 'JE sees only m2');
    eq(seen('AE').includes(m1), false, 'AE does not see Director->SE request');
    eq(seen('AE').includes(m2), true, 'AE sees SE->JE request');
    eq(seen('SE').includes(directorInternal), false, 'SE does not see Director internal remark');
    eq(seen('DEAN').includes(directorInternal), false, 'Dean does not see Director internal remark');
    eq(seen('DIRECTOR').includes(directorInternal), true, 'Director does');
    eq(all.filter((m) => canReadMessage({ role: 'APPLICANT', isApplicant: true }, m)).length, 0, 'applicant sees no internal rows');
  });

  await ok('JE report without the mandatory reply is refused', async () => {
    let code; try { await fileReport(deepak, id, ''); } catch (e) { code = e.code; }
    eq(code, 'MESSAGE_REQUIRED', 'code');
  });
  await ok('JE files v2 answering m2: version 2, answers_message_id, REPLY, request stays open below SE', async () => {
    const out = await fileReport(deepak, id, 'Rate analysis attached; estimate revised.');
    eq(out.version, 2, 'version');
    const rep = await one('SELECT version, answers_message_id FROM infra_reports WHERE id = ?', [out.reportId]);
    eq(rep.version, 2, 'row version'); eq(rep.answers_message_id, m2, 'answers m2');
    const reply = await one("SELECT to_desk, in_reply_to, visible_from_rank FROM infra_ticket_messages WHERE ticket_id = ? AND kind = 'REPLY'", [id]);
    eq(reply.to_desk, 'SE', 'reply addressed to the requester'); eq(reply.in_reply_to, m2, 'in_reply_to'); eq(reply.visible_from_rank, 1, 'rank of the replier');
    const t = await statusOf(id);
    eq(t.status, 'PENDING_AE_APPROVAL', 'at AE'); eq(t.open_change_request_id, m2, 'still open (AE rank < SE)');
  });
  await ok('AE FORWARD -> SE pops the request to the Director\'s; SE must REPLY to forward', async () => {
    const r = await act(ae, id, { action: 'FORWARD' });
    eq(r.body.open_change_request_id, m1, 'popped to m1');
    const noReply = await act(se, id, { action: 'FORWARD' });
    eq(noReply.statusCode, 400, 'http'); eq(noReply.body.code, 'MESSAGE_REQUIRED', 'reply mandatory');
    const okReply = await act(se, id, { action: 'FORWARD', message: 'Rate justified, see v2.' });
    eq(okReply.body.status, 'PENDING_DEAN_APPROVAL', 'to Dean');
  });
  await ok('Dean FORWARD -> Director clears the request; Director APPROVE (no limit) closes the thread', async () => {
    const r = await act(dean, id, { action: 'FORWARD' });
    eq(r.body.open_change_request_id, null, 'cleared on reaching the requester');
    const a = await act(dir, id, { action: 'APPROVE', public_note: 'Approved for tendering.' });
    eq(a.body.status, 'APPROVED_FOR_TENDERING', 'approved'); eq(a.body.current_desk_user_id, null, 'no desk person post-approval');
  });
  await ok('acting again on an approved ticket is refused', async () => {
    eq((await act(dir, id, { action: 'APPROVE' })).body.code, 'NOT_YOUR_DESK', 'code');
  });

  await ok('audit vocabulary + movement columns, in order', async () => {
    const rows = (await pool.query('SELECT action, from_status, to_status, from_desk, to_desk, visibility FROM infra_audit_logs WHERE ticket_id = ? ORDER BY id', [id]))[0];
    const seq = rows.map((r) => r.action).join(',');
    eq(seq, 'SUBMITTED,FORWARDED,FORWARDED,FORWARDED,CHANGES_REQUESTED,CHANGES_REQUESTED,SUBMITTED,FORWARDED,FORWARDED,FORWARDED,APPROVED', 'action sequence');
    const cr = rows.find((r) => r.action === 'CHANGES_REQUESTED');
    eq(cr.visibility, 'INTERNAL', 'change requests are INTERNAL');
    eq(`${cr.from_desk}>${cr.to_desk}`, 'DIRECTOR>SE', 'from/to desk'); eq(cr.to_status, 'PENDING_SE_APPROVAL', 'to_status');
  });
  await ok('report history kept: versions 1 and 2', async () => {
    const v = (await pool.query('SELECT version FROM infra_reports WHERE ticket_id = ? ORDER BY version', [id]))[0].map((r) => r.version);
    eq(JSON.stringify(v), '[1,2]', 'versions');
  });

  // ---- UNASSIGNED -> ASSIGN_JE --------------------------------------------------
  const [ins2] = await pool.query(
    `INSERT INTO infra_tickets (applicant_id, current_desk_user_id, department, campus, title, description, landmark, status)
     VALUES (?, ?, 'Civil', 'NORTH', 'Phase4 unassigned', 'd', 'l', 'UNASSIGNED')`, [applicant.id, ae.id]);
  const id2 = ins2.insertId; created.push(id2);
  await ok('ASSIGN_JE: ineligible JE (Electrical) refused; Civil JE accepted -> ASSIGNED_TO_JE', async () => {
    const bad = await act(ae, id2, { action: 'ASSIGN_JE', assignee_id: kapil.id });
    eq(bad.statusCode, 400, 'http'); eq(bad.body.code, 'INVALID_ASSIGNEE', 'code');
    const good = await act(ae, id2, { action: 'ASSIGN_JE', assignee_id: deepak.id });
    eq(good.body.status, 'ASSIGNED_TO_JE', 'status'); eq(good.body.current_desk_user_id, deepak.id, 'desk person');
    const t = await one('SELECT assigned_je_id, assigned_at FROM infra_tickets WHERE id = ?', [id2]);
    eq(t.assigned_je_id, deepak.id, 'assigned_je_id'); eq(t.assigned_at !== null, true, 'assigned_at set');
  });
  await ok('REJECT needs a reason, writes REJECTION_REASON + PUBLIC_NOTE', async () => {
    const [ins3] = await pool.query(
      `INSERT INTO infra_tickets (applicant_id, assigned_je_id, current_desk_user_id, department, campus, title, description, landmark, status)
       VALUES (?, ?, ?, 'Civil', 'NORTH', 'Phase4 reject', 'd', 'l', 'PENDING_SE_APPROVAL')`, [applicant.id, deepak.id, se.id]);
    created.push(ins3.insertId);
    eq((await act(se, ins3.insertId, { action: 'REJECT' })).statusCode, 400, 'no reason');
    const r = await act(se, ins3.insertId, { action: 'REJECT', message: 'Out of scope.', public_note: 'Request declined.' });
    eq(r.body.status, 'DENIED', 'status');
    const kinds = (await pool.query('SELECT kind FROM infra_ticket_messages WHERE ticket_id = ? ORDER BY id', [ins3.insertId]))[0].map((x) => x.kind).join(',');
    eq(kinds, 'REJECTION_REASON,PUBLIC_NOTE', 'kinds');
    eq(JSON.stringify((await listForTicket(pool, ins3.insertId)).filter((m) => canReadMessage({ role: 'APPLICANT', isApplicant: true }, m)).map((m) => m.kind)), '["PUBLIC_NOTE"]', 'applicant sees only the public note');
  });

  console.log(`\n${pass} passed, ${fail} failed.\n`);
}

run()
  .catch((e) => { console.error('Fatal:', e); fail++; })
  .finally(async () => {
    for (const id of created) await pool.query('DELETE FROM infra_tickets WHERE id = ?', [id]).catch((e) => console.error('cleanup failed', e.message));
    process.exit(fail > 0 ? 1 : 0);
  });
