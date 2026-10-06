// Integration test for Phase 5 + 6 against a live dev DB (migrations 001-006, seed-staff run).
// Real controllers/worker, FAKE mailer + FAKE clock: nothing is ever sent over SMTP.
//   DB_HOST=127.0.0.1 node scripts/test-notifications.mjs
// Do not point it at a database holding real pending notifications: the worker pass
// would mark them sent through the fake mailer.
import 'dotenv/config';
import http from 'node:http';
import pool from '../src/config/db.js';
import { processDueNotifications, MAX_ATTEMPTS } from '../src/cron/emailReminders.js';
import { notifyTicketCreated } from '../src/services/notifier.js';
import { performTicketAction } from '../src/controllers/actionController.js';
import { submitReport } from '../src/controllers/ticketController.js';
import { downloadAttachment } from '../src/controllers/attachmentController.js';
import { findDeskOwner } from '../src/models/deskModel.js';
import app from '../src/app.js';

let pass = 0, fail = 0;
async function ok(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const one = async (sql, params) => (await pool.query(sql, params))[0][0];
const all = async (sql, params) => (await pool.query(sql, params))[0];
const H = 3600e3;

function fakeRes() {
  const res = { statusCode: 200, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.sendFile = (p, o, cb) => { res.sent = p; res.statusCode = 200; cb?.(); };
  return res;
}
const fetchAtt = async (user, id) => { const res = fakeRes(); await downloadAttachment({ user, params: { id: String(id) } }, res); return res; };
const act = async (user, ticketId, body) => {
  const res = fakeRes();
  await performTicketAction({ user, params: { ticket_id: String(ticketId) }, body }, res);
  return res;
};

const created = [];
const mkTicket = async (applicantId, jeId, deskId, status, extra = {}) => {
  const [r] = await pool.query(
    `INSERT INTO mnt_tickets (applicant_id, assigned_je_id, current_desk_user_id, department, campus, title, description, location, landmark, status)
     VALUES (?, ?, ?, 'Civil', 'NORTH', ?, 'desc', 'loc', 'Block A', ?)`,
    [applicantId, jeId, deskId, extra.title ?? 'Phase5 test', status]);
  created.push(r.insertId);
  return r.insertId;
};
const enqueueCreated = async (ticketId, assignment, now) => {
  const c = await pool.getConnection();
  try { await c.beginTransaction(); await notifyTicketCreated(c, { ticketId, assignment, now }); await c.commit(); }
  catch (e) { await c.rollback(); throw e; } finally { c.release(); }
};

async function run() {
  console.log('\n=== Phase 5/6: outbox, reminders, sanitized mail, attachments (live DB, fake mailer) ===');
  // DATETIME has 1 s resolution: keep the fake clock on whole seconds.
  const T0 = new Date(Math.floor(Date.now() / 1000) * 1000);
  const deepak = await one("SELECT id, name, email, role, department FROM mnt_users WHERE email = 'deepak.chauhan@campus.edu'");
  const kapil = await one("SELECT id, name, email, role, department FROM mnt_users WHERE email = 'kapil.verma@campus.edu'");
  const applicant = await one("SELECT id, name, email, role, department FROM mnt_users WHERE role = 'APPLICANT' ORDER BY id LIMIT 1");
  if (!deepak || !kapil || !applicant) throw new Error('Run scripts/seed-staff.mjs first (and have one APPLICANT user).');
  const T = { department: 'Civil', campus: 'NORTH', assigned_je_id: deepak.id };
  const ae = await one('SELECT id, name, email, role, department FROM mnt_users WHERE id = ?', [(await findDeskOwner(pool, T, 'AE')).id]);
  const sent = [];
  const send = async (m) => { sent.push(m); };
  const pass_ = (t) => processDueNotifications({ now: new Date(T0.getTime() + t), send });

  const id = await mkTicket(applicant.id, deepak.id, deepak.id, 'ASSIGNED_TO_JE', { title: 'Leaking roof' });
  await enqueueCreated(id, { status: 'ASSIGNED_TO_JE', deskUser: deepak }, T0);

  await ok('creation queues 1 JE reminder series (instant) + 1 sanitized applicant mail, nothing sent inline', async () => {
    const rows = await all('SELECT kind, audience, desk, status, reminder_no FROM mnt_notifications WHERE ticket_id = ? ORDER BY id', [id]);
    eq(rows.map((r) => `${r.kind}/${r.audience}/${r.desk}/${r.status}/${r.reminder_no}`),
      ['REMINDER/STAFF/JE/PENDING/0', 'EMAIL/APPLICANT/null/PENDING/0'], 'rows');
    eq(sent.length, 0, 'no SMTP call yet');
  });

  await ok('instant pass: JE gets assignment mail (#1), applicant gets stage + link only', async () => {
    const t = await pass_(0);
    eq(t.sent, 2, 'two sent');
    const je = sent.find((m) => m.to === deepak.email);
    const ap = sent.find((m) => m.to === applicant.email);
    eq(je.subject.includes('Assigned to you'), true, 'JE assignment mail');
    eq(ap.subject.includes('Received') && ap.text.includes(`/ticket/${id}`), true, 'event + link');
    for (const bad of [deepak.name, deepak.email, ae.name, 'Phone', 'INR', '₹', 'Leaking roof', 'desc']) {
      eq(ap.subject.includes(bad) || ap.text.includes(bad), false, `applicant mail must not contain "${bad}"`);
    }
    const r = await one("SELECT reminder_no, next_due_at FROM mnt_notifications WHERE ticket_id = ? AND kind = 'REMINDER'", [id]);
    eq(r.reminder_no, 1, 'reminder_no'); eq(new Date(r.next_due_at).getTime(), T0.getTime() + 12 * H, 'next due +12h');
  });

  await ok('cadence with fake clock: nothing at +11h59m; #2 at +12h, #3 at +24h, #4 at +72h, #5 at +96h; nobody is ever copied', async () => {
    sent.length = 0;
    eq((await pass_(12 * H - 60e3)).sent, 0, 'not yet at 11:59');
    eq((await pass_(12 * H)).sent, 1, '#2'); eq(sent.at(-1).cc, undefined, '#2 no cc'); eq(sent.at(-1).subject.includes('Reminder 2'), true, 'subject #2');
    eq((await pass_(24 * H)).sent, 1, '#3'); eq(sent.at(-1).cc, undefined, '#3 no cc');
    eq((await pass_(48 * H)).sent, 0, 'nothing between #3 and #4');
    eq((await pass_(72 * H)).sent, 1, '#4'); eq(sent.at(-1).cc, undefined, '#4 no AE copy (digest covers overdue tickets)');
    eq((await pass_(96 * H)).sent, 1, '#5'); eq(sent.at(-1).cc, undefined, '#5 no AE copy');
    const n = await one("SELECT COUNT(*) AS c FROM mnt_audit_logs WHERE ticket_id = ? AND action = 'REMINDER_SENT'", [id]);
    eq(Number(n.c), 5, 'REMINDER_SENT audit rows (#1..#5)');
  });

  await ok('two workers at the same instant: the due reminder is sent exactly once', async () => {
    sent.length = 0;
    const [a, b] = await Promise.all([pass_(120 * H), pass_(120 * H)]);
    eq(a.sent + b.sent, 1, 'sent once across both workers');
    eq(sent.length, 1, 'one SMTP call');
  });

  await ok('JE files the report -> reminders stop; AE gets one arrival mail; applicant gets nothing for internal movement', async () => {
    const res = fakeRes();
    await submitReport({
      user: deepak, params: { ticket_id: String(id) },
      body: { nature_of_work: 'Replace sheet', estimated_amount: '15000' },
    }, res);
    eq(res.statusCode, 200, `submitReport http (${JSON.stringify(res.body)})`);
    const live = await all("SELECT id FROM mnt_notifications WHERE ticket_id = ? AND kind = 'REMINDER' AND status = 'PENDING'", [id]);
    eq(live.length, 0, 'no live reminders');
    sent.length = 0;
    await processDueNotifications({ now: new Date(T0.getTime() + 500 * H), send });
    eq(sent.filter((m) => m.to === deepak.email && m.subject.includes('Reminder')).length, 0, 'JE not reminded after report');
    eq(sent.filter((m) => m.to === ae.email && m.subject.includes('Awaiting your review')).length, 1, 'AE told once');
    eq(sent.some((m) => m.to === applicant.email), false, 'applicant: no mail for internal movement (R9)');
    eq(sent.some((m) => /₹|15000|Replace sheet|Phone/.test(m.text)), false, 'no amount / remark in any mail');
  });

  await ok('retry with backoff, then FAILED after MAX_ATTEMPTS; other mail unaffected', async () => {
    const [ins] = await pool.query(
      `INSERT INTO mnt_notifications (ticket_id, to_user_id, kind, audience, subject, body, next_due_at) VALUES (?, ?, 'EMAIL', 'STAFF', 's', 'b', ?)`,
      [id, deepak.id, T0]);
    const rowId = ins.insertId;
    const boom = async () => { throw new Error('smtp down'); };
    let clock = T0.getTime() + 1000 * H;
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      await processDueNotifications({ now: new Date(clock), send: boom });
      const r = await one('SELECT status, attempts, last_error, next_due_at FROM mnt_notifications WHERE id = ?', [rowId]);
      eq(r.attempts, i, `attempts after failure ${i}`);
      if (i < MAX_ATTEMPTS) {
        eq(r.status, 'PENDING', 'still pending');
        eq(new Date(r.next_due_at).getTime() - clock, 5 * 60e3 * 2 ** (i - 1), `backoff ${i}`);
        clock = new Date(r.next_due_at).getTime();
      } else {
        eq(r.status, 'FAILED', 'given up'); eq(r.last_error, 'smtp down', 'error kept');
      }
    }
  });

  await ok('UNASSIGNED: AE gets one notice and no reminders; ASSIGN_JE starts a JE series', async () => {
    const id2 = await mkTicket(applicant.id, null, ae.id, 'UNASSIGNED');
    await enqueueCreated(id2, { status: 'UNASSIGNED', deskUser: ae }, T0);
    sent.length = 0;
    await pass_(0);
    eq(sent.some((m) => m.to === ae.email && m.subject.includes('Needs a JE')), true, 'AE arrival mail');
    eq(sent.find((m) => m.to === applicant.email).subject.includes('Received'), true, 'applicant: Received');
    sent.length = 0;
    await pass_(12 * H);
    eq(sent.filter((m) => m.to === ae.email).length, 0, 'AE is not reminded');
    const r = await act(ae, id2, { action: 'ASSIGN_JE', assignee_id: deepak.id });
    eq(r.statusCode, 200, `assign (${JSON.stringify(r.body)})`);
    const live = await all("SELECT desk, to_user_id FROM mnt_notifications WHERE ticket_id = ? AND kind = 'REMINDER' AND status = 'PENDING'", [id2]);
    eq(live.map((x) => `${x.desk}:${x.to_user_id}`), [`JE:${deepak.id}`], 'only the new JE series is live');
  });

  await ok('worker cancels a reminder whose stage or recipient no longer applies (belt and braces)', async () => {
    const id3 = await mkTicket(applicant.id, deepak.id, deepak.id, 'ASSIGNED_TO_JE');
    await enqueueCreated(id3, { status: 'ASSIGNED_TO_JE', deskUser: deepak }, T0);
    await pool.query("UPDATE mnt_tickets SET status = 'PENDING_SE_APPROVAL' WHERE id = ?", [id3]); // moved without going through the notifier
    sent.length = 0;
    await pass_(0);
    eq(sent.filter((m) => m.to === deepak.email && m.subject.includes('Assigned to you')).length, 0, 'no JE mail');
    eq((await one("SELECT status FROM mnt_notifications WHERE ticket_id = ? AND kind = 'REMINDER'", [id3])).status, 'CANCELLED', 'cancelled');
  });

  // ---- Phase 6: attachments ---------------------------------------------------------
  const idA = await mkTicket(applicant.id, deepak.id, deepak.id, 'ASSIGNED_TO_JE');
  const addAtt = async (cat, url, by) => (await pool.query(
    'INSERT INTO mnt_attachments (ticket_id, file_url, uploaded_by, document_category) VALUES (?, ?, ?, ?)', [idA, url, by, cat]))[0].insertId;
  const evidence = await addAtt('APPLICANT_EVIDENCE', `/uploads/tickets/${idA}/applicant_evidence/1-2-leak.jpg`, applicant.id);
  const photo = await addAtt('JE_SITE_PHOTO', `/uploads/tickets/${idA}/je_reports/site_photos/1-2-site.png`, deepak.id);
  const doc = await addAtt('JE_ESTIMATE_DOC', `/uploads/tickets/${idA}/je_reports/estimate_docs/1-2-est.pdf`, deepak.id);
  const html = await addAtt('APPLICANT_EVIDENCE', `/uploads/tickets/${idA}/applicant_evidence/1-2-x.html`, applicant.id);
  const evil = await addAtt('APPLICANT_EVIDENCE', '/uploads/../../.env', applicant.id);

  await ok('attachments: applicant gets own evidence inline; JE photo/estimate doc are 404 for the applicant', async () => {
    const r = await fetchAtt(applicant, evidence);
    eq(r.statusCode, 200, 'evidence ok'); eq(r.headers['X-Content-Type-Options'], 'nosniff', 'nosniff');
    eq(r.headers['Content-Disposition'].startsWith('inline'), true, 'image inline'); eq(r.headers['Content-Type'], 'image/jpeg', 'type');
    eq(r.headers['Cache-Control'], 'private, no-store', 'no cache');
    eq((await fetchAtt(applicant, photo)).statusCode, 404, 'photo hidden'); eq((await fetchAtt(applicant, doc)).statusCode, 404, 'doc hidden');
  });
  await ok('attachments: assigned JE + AE + SYSADMIN read all; pdf is forced to download', async () => {
    const admin = await one("SELECT id, role FROM mnt_users WHERE role = 'SYSADMIN' AND is_active = TRUE LIMIT 1");
    for (const u of [deepak, ae, admin].filter(Boolean)) {
      for (const a of [evidence, photo, doc]) eq((await fetchAtt(u, a)).statusCode, 200, `${u.role} reads ${a}`);
    }
    eq((await fetchAtt(deepak, doc)).headers['Content-Disposition'].startsWith('attachment'), true, 'pdf attachment');
  });
  await ok('attachments: unrelated JE and out-of-scope AE get 404; unknown / malformed id 404', async () => {
    eq((await fetchAtt(kapil, evidence)).statusCode, 404, 'other JE');
    const otherAe = await one("SELECT id, name, email, role, department FROM mnt_users WHERE email = 'neeraj.chauhan@campus.edu'");
    eq((await fetchAtt(otherAe, evidence)).statusCode, 404, 'Electrical AE on Civil ticket');
    eq((await fetchAtt(deepak, 99999999)).statusCode, 404, 'unknown'); eq((await fetchAtt(deepak, '1abc')).statusCode, 404, 'malformed');
  });
  await ok('attachments: legacy .html file and a path-traversal file_url are never served', async () => {
    eq((await fetchAtt(applicant, html)).statusCode, 404, '.html'); eq((await fetchAtt(applicant, evil)).statusCode, 404, 'traversal');
  });

  await ok('app: direct /uploads/... URL is 404; /api/attachments/:id without a token is 401', async () => {
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const u = await fetch(`${base}/uploads/tickets/${idA}/applicant_evidence/1-2-leak.jpg`);
      eq(u.status, 404, '/uploads');
      eq((await fetch(`${base}/api/attachments/${evidence}`)).status, 401, 'no token');
      eq((await fetch(`${base}/api/attachments/${evidence}`, { headers: { Authorization: 'Bearer nope' } })).status, 401, 'bad token');
    } finally { server.close(); }
  });

  console.log(`\n${pass} passed, ${fail} failed.\n`);
}

run()
  .catch((e) => { console.error('Fatal:', e); fail++; })
  .finally(async () => {
    for (const id of created) await pool.query('DELETE FROM mnt_tickets WHERE id = ?', [id]).catch((e) => console.error('cleanup failed', e.message));
    process.exit(fail > 0 ? 1 : 0);
  });
