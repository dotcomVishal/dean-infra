// Phase 7 backend support: role dashboards (GET /tickets/desk) and the AE JE picker.
//   DB_HOST=127.0.0.1 node scripts/test-desk.mjs
// Real controllers against the live dev DB (migrations 001-006, seed-staff run). Test tickets are deleted at the end.
import 'dotenv/config';
import pool from '../src/config/db.js';
import { getDeskBoard, getAssignableJes } from '../src/controllers/deskController.js';
import { approvalLimitFor } from '../src/config/workflow.js';
import http from 'node:http';
import { auth } from '../src/config/firebase.js';
import app from '../src/app.js';

let pass = 0, fail = 0;
async function ok(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const one = async (sql, p) => (await pool.query(sql, p))[0][0];
const fakeRes = () => { const r = { statusCode: 200 }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
const board = async (user) => { const r = fakeRes(); await getDeskBoard({ user }, r); return r.body; };
const picker = async (user, id) => { const r = fakeRes(); await getAssignableJes({ user, params: { ticket_id: String(id) } }, r); return r; };

const created = [];
const mk = async (applicantId, jeId, deskId, status, dept = 'Civil', campus = 'NORTH') => {
  const [r] = await pool.query(
    `INSERT INTO tickets (applicant_id, assigned_je_id, current_desk_user_id, department, campus, title, description, location, status)
     VALUES (?, ?, ?, ?, ?, 'Desk test', 'desc', 'loc', ?)`, [applicantId, jeId, deskId, dept, campus, status]);
  created.push(r.insertId); return r.insertId;
};

try {
  console.log('\n=== Phase 7: desk board + JE picker (live DB) ===');
  const U = (email) => one('SELECT id, name, email, role, department FROM users WHERE email = ?', [email]);
  const deepak = await U('deepak.chauhan@campus.edu');
  const aeNorth = await one("SELECT u.id, u.name, u.role, u.department FROM users u JOIN user_scopes s ON s.user_id = u.id WHERE u.role='AE' AND s.department='Civil' AND s.campus IN ('NORTH','BOTH') LIMIT 1");
  const aeSouth = await one("SELECT u.id, u.name, u.role, u.department FROM users u JOIN user_scopes s ON s.user_id = u.id WHERE u.role='AE' AND s.department='Civil' AND s.campus='SOUTH' AND u.id <> ? LIMIT 1", [aeNorth.id]);
  const se = await one("SELECT id, name, role, department FROM users WHERE role='SE' AND is_active=TRUE LIMIT 1");
  const director = await one("SELECT id, name, role, department FROM users WHERE role='DIRECTOR' LIMIT 1");
  const applicant = await one("SELECT id, name, email, role, department FROM users WHERE role = 'APPLICANT' ORDER BY id LIMIT 1");
  if (!deepak || !aeNorth || !se || !director || !applicant) throw new Error('Run scripts/seed-staff.mjs first (and have one APPLICANT user).');

  const unassigned = await mk(applicant.id, null, aeNorth.id, 'UNASSIGNED');
  const atJe = await mk(applicant.id, deepak.id, deepak.id, 'ASSIGNED_TO_JE');
  const atSe = await mk(applicant.id, deepak.id, se.id, 'PENDING_SE_APPROVAL');
  await pool.query("INSERT INTO audit_logs (ticket_id, user_id, action, remarks) VALUES (?, ?, 'SUBMITTED', 'x')", [atSe, deepak.id]);

  await ok("AE 'My desk' pulls in the UNASSIGNED queue of their scope", async () => {
    const b = await board(aeNorth);
    const row = b.my_desk.find((t) => t.id === unassigned);
    eq(!!row, true, 'UNASSIGNED ticket present'); eq(row.on_my_desk, true, 'on_my_desk'); eq(row.status, 'UNASSIGNED', 'status');
  });

  if (aeSouth) await ok('an AE of the other campus does not get it', async () => {
    eq((await board(aeSouth)).my_desk.some((t) => t.id === unassigned), false, 'other campus');
  });

  await ok('JE desk = assigned tickets at the JE stage; Watching = moved-on tickets they acted on', async () => {
    const b = await board(deepak);
    eq(b.my_desk.some((t) => t.id === atJe), true, 'at JE');
    eq(b.my_desk.some((t) => t.id === atSe), false, 'moved on is not on the desk');
    eq(b.watching.some((t) => t.id === atSe), true, 'watching');
  });

  await ok('rows carry desk_since for SLA ageing and never leak the desk owner id', async () => {
    const row = (await board(se)).my_desk.find((t) => t.id === atSe);
    eq(!!row.desk_since, true, 'desk_since'); eq('current_desk_user_id' in row, false, 'no owner id');
  });

  await ok('approval limits come from financial_limits, not code', async () => {
    const limits = Object.fromEntries((await pool.query('SELECT `key`, max_amount FROM financial_limits'))[0].map((r) => [r.key, Number(r.max_amount)]));
    eq((await board(se)).approval_limit, { can_approve: true, unlimited: false, amount: limits.SE_APPROVE ?? null }, 'SE');
    eq((await board(director)).approval_limit, { can_approve: true, unlimited: true, amount: null }, 'Director');
    eq((await board(aeNorth)).approval_limit, { can_approve: false, unlimited: false, amount: null }, 'AE');
    eq(approvalLimitFor('DEAN', { DEAN_APPROVE: 7 }).amount, 7, 'Dean reads the passed limit');
    eq(approvalLimitFor('SE', {}).amount, null, 'missing row fails closed (null)');
  });

  await ok('applicant: no watching, no desk, My tickets is the applicant projection (no staff fields)', async () => {
    const b = await board(applicant);
    eq(b.my_desk, [], 'no desk'); eq(b.watching, [], 'no watching');
    const mine = b.my_tickets.find((t) => t.id === atSe);
    eq(!!mine && mine.stage_label === 'Under review', true, 'plain stage');
    for (const k of ['assigned_je_id', 'current_desk_user_id', 'estimated_amount', 'applicant_phone', 'applicant_email']) eq(k in mine, false, `no ${k}`);
  });

  await ok('a staff user never sees their own raised tickets under Watching', async () => {
    const own = await mk(aeNorth.id, deepak.id, deepak.id, 'ASSIGNED_TO_JE');
    await pool.query("INSERT INTO audit_logs (ticket_id, user_id, action, remarks) VALUES (?, ?, 'CREATED', 'x')", [own, aeNorth.id]);
    const b = await board(aeNorth);
    eq(b.watching.some((t) => t.id === own), false, 'not watching'); eq(b.my_tickets.some((t) => t.id === own), true, 'in my tickets');
  });

  await ok('JE picker: desk owner gets scope JEs (campus match first); anyone else / wrong status gets 404', async () => {
    const r = await picker(aeNorth, unassigned);
    eq(r.statusCode, 200, 'status'); eq(r.body.jes.length > 0, true, 'has JEs');
    eq(r.body.jes[0].same_campus, true, 'campus-matched first');
    eq(Object.keys(r.body.jes[0]).sort(), ['id', 'name', 'on_leave', 'open_tickets', 'same_campus'].sort(), 'no email/phone');
    eq((await picker(se, unassigned)).statusCode, 404, 'other user');
    if (aeSouth) eq((await picker(aeSouth, unassigned)).statusCode, 404, 'other AE');
    eq((await picker(aeNorth, atJe)).statusCode, 404, 'not UNASSIGNED');
  });

  // ---- HTTP: the details payload the unified ticket page renders from ----
  const saved = new Map();
  const asUser = async (u) => {
    if (!saved.has(u.id)) {
      saved.set(u.id, (await one('SELECT firebase_uid FROM users WHERE id = ?', [u.id])).firebase_uid);
      await pool.query('UPDATE users SET firebase_uid = ? WHERE id = ?', [`test-desk-${u.id}`, u.id]);
    }
    return { Authorization: `Bearer test-desk-${u.id}` };
  };
  const realVerify = auth.verifyIdToken;
  auth.verifyIdToken = async (t) => ({ uid: t, email: 'x@x', email_verified: true, firebase: { sign_in_provider: 'google.com' } });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/api/tickets`;
  const get = async (u, path) => { const r = await fetch(base + path, { headers: await asUser(u) }); return { status: r.status, body: await r.json() }; };
  try {
    await pool.query("INSERT INTO reports (ticket_id, je_id, version, nature_of_work, estimated_amount) VALUES (?, ?, 1, 'Fix pipe', 12345)", [atSe, deepak.id]);
    const limits = Object.fromEntries((await pool.query('SELECT `key`, max_amount FROM financial_limits'))[0].map((r) => [r.key, Number(r.max_amount)]));

    await ok('details for the desk owner: available_actions + approval_limit + lower-desk names from the API', async () => {
      const r = await get(se, `/${atSe}/details`);
      eq(r.status, 200, 'status');
      const t = r.body.ticket;
      eq(t.available_actions.desk, 'SE', 'desk');
      eq(t.available_actions.actions.map((a) => a.action).sort(), ['APPROVE', 'FORWARD', 'REJECT', 'REQUEST_CHANGES'], 'buttons');
      eq(t.approval_limit, { can_approve: true, unlimited: false, amount: limits.SE_APPROVE ?? null }, 'limit from API');
      eq(t.desk_people.JE, deepak.name, 'JE name for the Send-to list');
      eq(typeof t.desk_people.AE, 'string', 'AE name');
      eq(t.attachments.every((a) => a.download_url.startsWith('/api/attachments/') && !('file_url' in a)), true, 'attachments by id');
    });

    await ok('details for a viewer who is not on the desk: no buttons, no limit, no names', async () => {
      const r = await get(director, `/${atSe}/details`);
      eq(r.body.ticket.available_actions.actions, [], 'no buttons');
      eq('approval_limit' in r.body.ticket, false, 'no limit'); eq('desk_people' in r.body.ticket, false, 'no names');
    });

    await ok('details for the applicant: stage in plain words, no staff/financial fields at all', async () => {
      const r = await get(applicant, `/${atSe}/details`);
      eq(r.status, 200, 'status');
      const t = r.body.ticket;
      eq(t.stage_label, 'Under review', 'stage');
      for (const k of ['applicant_id', 'applicant_name', 'applicant_phone', 'assigned_je_id', 'current_desk_user_id', 'desk_people', 'approval_limit'])
        eq(k in t, false, `no ${k}`);
      eq(t.report, null, 'no report'); eq(t.audit_logs, [], 'no audit trail'); eq(t.tenders, [], 'no tenders'); eq(t.bills, [], 'no bills'); eq(t.available_actions, { desk: null, actions: [] }, 'no buttons');
      eq(JSON.stringify(t).includes('12345'), false, 'estimate nowhere in payload');
      eq(JSON.stringify(t).includes(deepak.name), false, 'JE name nowhere in payload');
    });

    await ok('GET /tickets/desk over HTTP requires a token and returns the board', async () => {
      eq((await fetch(`${base}/desk`)).status, 401, 'no token');
      const r = await get(se, '/desk');
      eq(r.status, 200, 'status'); eq(r.body.my_desk.some((t) => t.id === atSe), true, 'SE desk lists it');
    });

    await ok('assignable-jes over HTTP: role AE only', async () => {
      eq((await get(aeNorth, `/${unassigned}/assignable-jes`)).status, 200, 'AE ok');
      eq((await get(se, `/${unassigned}/assignable-jes`)).status, 403, 'SE role gate');
      eq((await get(applicant, `/${unassigned}/assignable-jes`)).status, 403, 'applicant role gate');
    });
  } finally {
    auth.verifyIdToken = realVerify;
    await new Promise((r) => server.close(r));
    for (const [id, uid] of saved) await pool.query('UPDATE users SET firebase_uid = ? WHERE id = ?', [uid, id]);
  }
} finally {
  for (const id of created) await pool.query('DELETE FROM tickets WHERE id = ?', [id]).catch((e) => console.error('cleanup failed', e.message));
  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}
