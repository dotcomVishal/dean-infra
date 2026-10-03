// Master plan section 5 through the real routes: who is mailed for what, how often, and the weekly digest.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import app from '../../src/app.js';
import { auth } from '../../src/config/firebase.js';
import { findDeskOwner } from '../../src/models/deskModel.js';
import { startDeskReminders } from '../../src/services/notifier.js';
import { isoWeekIst, runDigest } from '../../src/services/digest.js';
import { processDueNotifications } from '../../src/cron/emailReminders.js';
import { makeUser, makeOpenTicket, putOnLeave, trackTicket, cleanup, pool } from './helpers.mjs';

let server;
let base;
before(async () => {
  auth.verifyIdToken = async (token) => ({
    uid: token, email: `${token}@test.local`, email_verified: true, firebase: { sign_in_provider: 'google.com' },
  });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => { await cleanup(); await pool.query("DELETE FROM infra_notifications WHERE kind = 'DIGEST'"); });
after(async () => { await cleanup(); await pool.query("DELETE FROM infra_notifications WHERE kind = 'DIGEST'"); server.closeAllConnections?.(); server.close(); await pool.end(); });

const uidOf = async (id) => (await pool.query('SELECT firebase_uid FROM infra_users WHERE id = ?', [id]))[0][0].firebase_uid;
async function http(token, method, url, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(base + url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const civil = (userId, campus = 'NORTH') => pool.query("INSERT INTO infra_user_scopes (user_id, department, campus) VALUES (?, 'Civil', ?)", [userId, campus]);
const mailsOf = async (ticketId) => (await pool.query('SELECT to_user_id, kind, subject FROM infra_notifications WHERE ticket_id = ? ORDER BY id', [ticketId]))[0];
const row = async (id) => (await pool.query('SELECT * FROM infra_tickets WHERE id = ?', [id]))[0][0];

async function raise(token) {
  const f = new FormData();
  Object.entries({ department: 'Civil', campus: 'NORTH', description: 'Leak', landmark: 'B3', contact_phone: '9999999999', title: 'Leak' })
    .forEach(([k, v]) => f.append(k, v));
  const r = await http(token, 'POST', '/api/tickets', f);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return trackTicket(r.body.ticket_id);
}

test('a full ticket life mails only the JE and the person who raised it; never AE, SE, Dean or Director', async () => {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je = await makeUser({ role: 'JE' }); await civil(je);
  const ae = await makeUser({ role: 'AE' }); await civil(ae);
  const se = await makeUser({ role: 'SE' });
  const T = { applicant: await uidOf(applicant), je: await uidOf(je), ae: await uidOf(ae), se: await uidOf(se) };

  const ticketId = await raise(T.applicant);
  assert.equal((await row(ticketId)).assigned_je_id, je);
  const dean = (await findDeskOwner(pool, await row(ticketId), 'DEAN')).id;
  const director = (await findDeskOwner(pool, await row(ticketId), 'DIRECTOR')).id;
  T.dean = await uidOf(dean);
  T.director = await uidOf(director);
  await pool.query('UPDATE infra_tickets SET assigned_se_id = ? WHERE id = ?', [se, ticketId]);

  const rep = new FormData();
  rep.append('nature_of_work', 'Fix'); rep.append('estimated_amount', '9000');
  assert.equal((await http(T.je, 'POST', `/api/tickets/${ticketId}/report`, rep)).status, 200);
  for (const [who, action] of [['ae', 'FORWARD'], ['se', 'FORWARD'], ['dean', 'FORWARD'], ['director', 'APPROVE']]) {
    const r = await http(T[who], 'POST', `/api/tickets/${ticketId}/actions`, { action });
    assert.equal(r.status, 200, `${who} ${action}: ${JSON.stringify(r.body)}`);
  }
  assert.equal((await row(ticketId)).status, 'APPROVED_FOR_TENDERING');
  assert.equal((await http(T.je, 'POST', `/api/tickets/${ticketId}/lifecycle`, { action: 'PUBLISH_TENDER', tender_created_date: '2026-10-01', tender_end_date: '2026-10-09' })).status, 200);
  for (const a of [{ action: 'START_TECHNICAL_EVAL' }, { action: 'START_FINANCIAL_EVAL' }, { action: 'AWARD', award_amount: '8500', awarded_agency: 'ABC' }]) {
    assert.equal((await http(T.je, 'POST', `/api/tickets/${ticketId}/lifecycle`, a)).status, 200);
  }
  assert.equal((await http(T.je, 'POST', `/api/tickets/${ticketId}/lifecycle`, { action: 'RESOLVE' })).status, 200);
  assert.equal((await http(T.applicant, 'POST', `/api/tickets/${ticketId}/confirm-completion`, { accepted: true })).status, 200);

  const mails = await mailsOf(ticketId);
  const recipients = new Set(mails.map((m) => m.to_user_id));
  assert.deepEqual([...recipients].sort(), [je, applicant].sort(), JSON.stringify(mails));
  for (const id of [ae, se, dean, director]) assert.ok(!recipients.has(id), `user ${id} got mail`);
  const subjects = mails.map((m) => m.subject).join('\n');
  assert.match(subjects, /assigned to you/);
  assert.match(subjects, /approved/);
  assert.match(subjects, /resolved: please confirm/);
  assert.match(subjects, /closed/);
});

test('UNASSIGNED: the AE gets one mail and no reminder series; choosing a JE mails the JE with a series', async () => {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je = await makeUser({ role: 'JE' }); await civil(je);
  const ae = await makeUser({ role: 'AE' }); await civil(ae);
  const cleanLeave = await putOnLeave(je, ae);
  const ticketId = await raise(await uidOf(applicant));
  assert.equal((await row(ticketId)).status, 'UNASSIGNED');
  let mails = await mailsOf(ticketId);
  assert.deepEqual(mails.filter((m) => m.to_user_id === ae).map((m) => m.kind), ['EMAIL']);
  assert.ok(/needs a JE/.test(mails.find((m) => m.to_user_id === ae).subject));
  assert.equal(mails.filter((m) => m.kind === 'REMINDER').length, 0, 'no series for the AE');

  await cleanLeave();
  const r = await http(await uidOf(ae), 'POST', `/api/tickets/${ticketId}/actions`, { action: 'ASSIGN_JE', assignee_id: je });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  mails = await mailsOf(ticketId);
  assert.deepEqual(mails.filter((m) => m.to_user_id === je).map((m) => m.kind), ['REMINDER']);
  assert.equal(mails.filter((m) => m.to_user_id === ae).length, 1, 'the AE is not mailed again');
});

test('JE reminders have no AE copy, ever', async () => {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je = await makeUser({ role: 'JE' }); await civil(je);
  await makeUser({ role: 'AE' });
  const ticketId = await raise(await uidOf(applicant));
  const sent = [];
  const t0 = new Date();
  for (const h of [0, 12, 24, 72, 96, 120]) await processDueNotifications({ now: new Date(t0.getTime() + h * 3600e3 + 60e3), send: async (m) => { sent.push(m); } });
  const toJe = sent.filter((m) => m.subject.includes('Reminder') || m.subject.includes('assigned'));
  assert.ok(toJe.length >= 6, `JE mails: ${toJe.length}`);
  assert.ok(sent.every((m) => m.cc === undefined), 'no cc');
  assert.ok(sent.some((m) => /Reminder 4: #TKT-\d+ pending 7\d h/.test(m.subject)), sent.map((m) => m.subject).join(' | '));
  assert.ok(ticketId);
});

test('reassigning the JE: the old JE hears "no action needed", the new JE gets the assignment and a series', async () => {
  const admin = await makeUser({ role: 'SYSADMIN' });
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je1 = await makeUser({ role: 'JE' });
  const je2 = await makeUser({ role: 'JE' });
  const ae = await makeUser({ role: 'AE' });
  const ticketId = await makeOpenTicket(applicant, je1, 'ASSIGNED_TO_JE');
  await pool.query('UPDATE infra_tickets SET assigned_ae_id = ?, current_desk_user_id = ? WHERE id = ?', [ae, je1, ticketId]);
  const token = await uidOf(admin);

  const r = await http(token, 'POST', `/api/admin/tickets/${ticketId}/override`, { remarks: 'cover', reassign: { desk: 'JE', user_id: je2 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const mails = await mailsOf(ticketId);
  assert.deepEqual(mails.filter((m) => m.to_user_id === je1).map((m) => /no action needed|reassigned/i.test(m.subject)), [true]);
  assert.deepEqual(mails.filter((m) => m.to_user_id === je2).map((m) => m.kind), ['REMINDER']);
  assert.ok(!mails.some((m) => m.to_user_id === ae));

  // Same JE again: nothing new.
  const before = (await mailsOf(ticketId)).length;
  await http(token, 'POST', `/api/admin/tickets/${ticketId}/override`, { remarks: 'again', reassign: { desk: 'JE', user_id: je2 } });
  assert.equal((await mailsOf(ticketId)).filter((m) => m.to_user_id === je1).length, 1, 'the old JE is not told twice');
  assert.ok((await mailsOf(ticketId)).length >= before);
});

test('forcing a ticket to an approval desk mails nobody there', async () => {
  const admin = await makeUser({ role: 'SYSADMIN' });
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je = await makeUser({ role: 'JE' });
  const ae = await makeUser({ role: 'AE' });
  const ticketId = await makeOpenTicket(applicant, je, 'ASSIGNED_TO_JE');
  await pool.query('UPDATE infra_tickets SET assigned_ae_id = ? WHERE id = ?', [ae, ticketId]);
  const r = await http(await uidOf(admin), 'POST', `/api/admin/tickets/${ticketId}/override`, { remarks: 'move', new_status: 'PENDING_AE_APPROVAL' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(!(await mailsOf(ticketId)).some((m) => m.to_user_id === ae));
});

test('startDeskReminders refuses any desk but the JE and the confirmer', async () => {
  const u = await makeUser({ role: 'AE' });
  const email = { subject: 's', body: 'b' };
  for (const desk of ['AE', 'SE', 'DEAN', 'DIRECTOR']) {
    await assert.rejects(startDeskReminders(pool, { ticketId: 1, desk, user: { id: u }, email }), /only for the JE and the confirmer/);
  }
});

// ---- weekly digest ----------------------------------------------------------------------------
const NOW = new Date('2026-10-05T03:30:00Z'); // Monday 09:00 IST
const digestRows = async (ids) => (await pool.query("SELECT to_user_id, subject, body, dedupe_key FROM infra_notifications WHERE kind = 'DIGEST' AND to_user_id IN (?)", [ids]))[0];

test('digest: one per AE, SE and Dean per week, none on a rerun, none for the Director or an empty desk', async () => {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je = await makeUser({ role: 'JE' });
  const ae = await makeUser({ role: 'AE' }); await civil(ae);
  const emptyAe = await makeUser({ role: 'AE' });
  const se = await makeUser({ role: 'SE' });
  const dean = await makeUser({ role: 'DEAN' });
  const director = await makeUser({ role: 'DIRECTOR' });
  const t1 = await makeOpenTicket(applicant, je, 'PENDING_AE_APPROVAL');
  const t2 = await makeOpenTicket(applicant, je, 'PENDING_AE_APPROVAL');
  const t3 = await makeOpenTicket(applicant, je, 'PENDING_SE_APPROVAL');
  const t4 = await makeOpenTicket(applicant, je, 'PENDING_DEAN_APPROVAL');
  const t5 = await makeOpenTicket(applicant, je, 'PENDING_DIRECTOR_APPROVAL');
  const ago = (d) => new Date(NOW.getTime() - d * 86400e3);
  for (const [id, holder, days] of [[t1, ae, 12], [t2, ae, 3], [t3, se, 5], [t4, dean, 2], [t5, director, 9]]) {
    await pool.query('UPDATE infra_tickets SET current_desk_user_id = ?, status_changed_at = ? WHERE id = ?', [holder, ago(days), id]);
  }
  // A test ticket and a deleted ticket never count.
  const mock = await makeOpenTicket(applicant, je, 'PENDING_AE_APPROVAL');
  await pool.query('UPDATE infra_tickets SET current_desk_user_id = ?, is_mock = TRUE WHERE id = ?', [ae, mock]);
  const gone = await makeOpenTicket(applicant, je, 'PENDING_AE_APPROVAL');
  await pool.query('UPDATE infra_tickets SET current_desk_user_id = ?, deleted_at = NOW() WHERE id = ?', [ae, gone]);

  const ids = [ae, emptyAe, se, dean, director];
  const q1 = await runDigest({ now: NOW });
  assert.ok(q1 >= 3);
  let rows = await digestRows(ids);
  assert.deepEqual(rows.map((r) => r.to_user_id).sort(), [ae, se, dean].sort(), 'AE, SE, Dean only');
  const week = isoWeekIst(NOW);
  assert.equal(week, '2026-W41');
  for (const r of rows) assert.equal(r.dedupe_key, `digest:${r.to_user_id}:${week}`);

  const aeMail = rows.find((r) => r.to_user_id === ae);
  assert.equal(aeMail.subject, '[Infra] Weekly summary: 2 tickets at your desk');
  assert.ok(aeMail.body.indexOf(`#TKT-${String(t1).padStart(4, '0')}`) < aeMail.body.indexOf(`#TKT-${String(t2).padStart(4, '0')}`), 'oldest first');
  assert.ok(!aeMail.body.includes(`#TKT-${String(mock).padStart(4, '0')}`) && !aeMail.body.includes(`#TKT-${String(gone).padStart(4, '0')}`));
  assert.match(aeMail.body, /12 days/);
  assert.match(aeMail.body, /In your scope: \d+ with JEs/);

  assert.equal(await runDigest({ now: new Date(NOW.getTime() + 3600e3) }), 0, 'a rerun the same week queues nothing');
  assert.equal((await digestRows(ids)).length, 3);
  // Next week is a new digest.
  const next = new Date(NOW.getTime() + 7 * 86400e3);
  await runDigest({ now: next });
  assert.equal((await digestRows(ids)).length, 6);
});

test('digest: an AE who must confirm a JE-raised resolve sees it, and it is sent through the normal outbox', async () => {
  const je = await makeUser({ role: 'JE' });
  const ae = await makeUser({ role: 'AE' }); await civil(ae);
  const id = await makeOpenTicket(je, je, 'WORK_COMPLETED');
  await pool.query('UPDATE infra_tickets SET current_desk_user_id = ?, assigned_ae_id = ?, resolved_at = ? WHERE id = ?', [ae, ae, NOW, id]);
  await runDigest({ now: NOW });
  const [mail] = await digestRows([ae]);
  assert.match(mail.body, /Waiting for your confirmation: 1\./);
  const sent = [];
  await processDueNotifications({ now: new Date(NOW.getTime() + 60e3), send: async (m) => { sent.push(m); } });
  assert.ok(sent.some((m) => /Weekly summary/.test(m.subject)));
});
