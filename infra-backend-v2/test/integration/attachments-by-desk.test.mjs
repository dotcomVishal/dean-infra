// Master plan section 4: files travel with a move (same transaction, linked to the timeline row),
// every file records the person and desk that attached it, and a refused upload writes nothing.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import app from '../../src/app.js';
import { auth } from '../../src/config/firebase.js';
import { MAX_FILES_PER_TICKET } from '../../src/utils/fileManager.js';
import { makeUser, makeOpenTicket, cleanup, pool } from './helpers.mjs';

const TEMP = path.join(process.env.UPLOADS_DIR, 'temp');
fs.mkdirSync(TEMP, { recursive: true });
const tempFiles = () => new Set(fs.readdirSync(TEMP));
const onDisk = (id) => {
  const dir = path.join(process.env.UPLOADS_DIR, 'tickets', String(id));
  return fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((p) => /\.[a-z]+$/.test(String(p))) : [];
};

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

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
beforeEach(cleanup);
after(async () => { await cleanup(); server.close(); await pool.end(); });

const uidOf = async (id) => (await pool.query('SELECT firebase_uid FROM infra_users WHERE id = ?', [id]))[0][0].firebase_uid;
async function http(token, method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const form = (fields, files = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  for (const [name, buf, type] of files) f.append('files', new Blob([buf], { type }), name);
  return f;
};

/** Ticket sitting at the AE desk with a filed report, plus the people around it. */
async function atAeDesk() {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je = await makeUser({ role: 'JE' });
  const ae = await makeUser({ role: 'AE' });
  const se = await makeUser({ role: 'SE' });
  const stranger = await makeUser({ role: 'APPLICANT' });
  const ticketId = await makeOpenTicket(applicant, je);
  await pool.query('UPDATE infra_tickets SET assigned_ae_id = ?, assigned_se_id = ?, current_desk_user_id = ? WHERE id = ?', [ae, se, je, ticketId]);
  const t = { applicant: await uidOf(applicant), je: await uidOf(je), ae: await uidOf(ae), se: await uidOf(se), stranger: await uidOf(stranger) };
  const rep = new FormData();
  rep.append('nature_of_work', 'Fix'); rep.append('estimated_amount', '1000');
  assert.equal((await http(t.je, 'POST', `/api/tickets/${ticketId}/report`, rep)).status, 200);
  return { ticketId, ids: { applicant, je, ae, se }, t };
}

const attachments = async (ticketId) => (await pool.query(
  'SELECT id, document_category, uploader_desk, audit_log_id, uploaded_by, original_name FROM infra_attachments WHERE ticket_id = ? ORDER BY id', [ticketId]))[0];

test('FORWARD with files: files are stored, linked to the FORWARDED row, and say who and which desk', async () => {
  const { ticketId, ids, t } = await atAeDesk();
  const res = await http(t.ae, 'POST', `/api/tickets/${ticketId}/actions`,
    form({ action: 'FORWARD' }, [['note.pdf', PDF, 'application/pdf'], ['site.jpg', JPEG, 'image/jpeg']]));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const rows = await attachments(ticketId);
  assert.equal(rows.length, 2);
  const [[audit]] = await pool.query("SELECT id, action, user_id FROM infra_audit_logs WHERE ticket_id = ? AND action = 'FORWARDED'", [ticketId]);
  for (const r of rows) {
    assert.equal(r.document_category, 'DESK_DOC');
    assert.equal(r.uploader_desk, 'AE');
    assert.equal(r.uploaded_by, ids.ae);
    assert.equal(r.audit_log_id, audit.id);
  }
});

test('REQUEST_CHANGES with a file works, and the JSON form still works with no file', async () => {
  const { ticketId, t } = await atAeDesk();
  const a = await http(t.ae, 'POST', `/api/tickets/${ticketId}/actions`,
    form({ action: 'REQUEST_CHANGES', to_desk: 'JE', message: 'More photos' }, [['ref.pdf', PDF, 'application/pdf']]));
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal((await attachments(ticketId)).filter((r) => r.uploader_desk === 'AE').length, 1);
  const rep = new FormData();
  rep.append('nature_of_work', 'Fix'); rep.append('estimated_amount', '1000'); rep.append('remarks', 'Done');
  assert.equal((await http(t.je, 'POST', `/api/tickets/${ticketId}/report`, rep)).status, 200);
  const b = await http(t.ae, 'POST', `/api/tickets/${ticketId}/actions`, { action: 'FORWARD' });
  assert.equal(b.status, 200, JSON.stringify(b.body));
});

test('a refused action with files leaves no rows and no files', async () => {
  const { ticketId, t } = await atAeDesk();
  const before = tempFiles();
  const res = await http(t.ae, 'POST', `/api/tickets/${ticketId}/actions`,
    form({ action: 'APPROVE' }, [['x.pdf', PDF, 'application/pdf']])); // an AE cannot APPROVE
  assert.equal(res.status, 403);
  assert.deepEqual(await attachments(ticketId), []);
  assert.deepEqual(onDisk(ticketId).filter((p) => /desk_docs/.test(String(p))), []);
  assert.deepEqual([...tempFiles()].filter((n) => !before.has(n)), []);
});

test('ASSIGN_JE takes no files', async () => {
  const { ticketId, t } = await atAeDesk();
  const res = await http(t.ae, 'POST', `/api/tickets/${ticketId}/actions`,
    form({ action: 'ASSIGN_JE', assignee_id: '1' }, [['x.pdf', PDF, 'application/pdf']]));
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'FILES_NOT_ALLOWED');
});

test('an outsider is refused with 403 before anything is written to disk', async () => {
  const { ticketId, t } = await atAeDesk();
  const before = tempFiles();
  const res = await http(t.stranger, 'POST', `/api/tickets/${ticketId}/attachments`,
    form({}, [['x.jpg', JPEG, 'image/jpeg']]));
  assert.equal(res.status, 403);
  assert.deepEqual([...tempFiles()].filter((n) => !before.has(n)), []);
  assert.deepEqual(await attachments(ticketId), []);
});

test('a standalone upload records the desk and writes a FILES_ADDED timeline entry; a JE at a higher desk leaves a trace', async () => {
  const { ticketId, ids, t } = await atAeDesk();
  const before = (await attachments(ticketId)).length;
  const a = await http(t.ae, 'POST', `/api/tickets/${ticketId}/attachments`, form({}, [['n.pdf', PDF, 'application/pdf']]));
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const j = await http(t.je, 'POST', `/api/tickets/${ticketId}/attachments`, form({}, [['est.pdf', PDF, 'application/pdf']]));
  assert.equal(j.status, 201, JSON.stringify(j.body));
  const rows = (await attachments(ticketId)).slice(before);
  assert.deepEqual(rows.map((r) => [r.uploader_desk, r.document_category]), [['AE', 'DESK_DOC'], ['JE', 'JE_ESTIMATE_DOC']]);
  const [logs] = await pool.query("SELECT user_id FROM infra_audit_logs WHERE ticket_id = ? AND action = 'FILES_ADDED' ORDER BY id", [ticketId]);
  assert.deepEqual(logs.map((l) => l.user_id), [ids.ae, ids.je]);
  for (const r of rows) assert.ok(r.audit_log_id, 'linked to its timeline entry');
});

test('the per-ticket cap holds', async () => {
  const { ticketId, ids, t } = await atAeDesk();
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM infra_attachments WHERE ticket_id = ?', [ticketId]);
  const fill = MAX_FILES_PER_TICKET - n;
  for (let i = 0; i < fill; i += 1) {
    await pool.query("INSERT INTO infra_attachments (ticket_id, file_url, uploaded_by, document_category) VALUES (?, '/uploads/x.pdf', ?, 'DESK_DOC')", [ticketId, ids.ae]);
  }
  const before = tempFiles();
  const res = await http(t.ae, 'POST', `/api/tickets/${ticketId}/attachments`, form({}, [['n.pdf', PDF, 'application/pdf']]));
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'TICKET_FILE_LIMIT');
  assert.deepEqual([...tempFiles()].filter((x) => !before.has(x)), []);
});

test('details: staff (the JE too) see who attached each file; the applicant sees no staff names or desks', async () => {
  const { ticketId, ids, t } = await atAeDesk();
  assert.equal((await http(t.ae, 'POST', `/api/tickets/${ticketId}/attachments`, form({}, [['n.pdf', PDF, 'application/pdf']]))).status, 201);
  const ev = await http(t.applicant, 'POST', `/api/tickets/${ticketId}/attachments`, form({}, [['mine.jpg', JPEG, 'image/jpeg']]));
  assert.equal(ev.status, 201, JSON.stringify(ev.body));

  const [[ae]] = await pool.query('SELECT name FROM infra_users WHERE id = ?', [ids.ae]);
  for (const viewer of [t.je, t.ae, t.se]) {
    const d = await http(viewer, 'GET', `/api/tickets/${ticketId}/details`);
    assert.equal(d.status, 200, JSON.stringify(d.body));
    const file = d.body.ticket.attachments.find((a) => a.file_name === 'n.pdf');
    assert.ok(file, 'viewer sees the desk document');
    assert.equal(file.uploader_desk, 'AE');
    assert.equal(file.uploader_name, ae.name);
  }
  const app = await http(t.applicant, 'GET', `/api/tickets/${ticketId}/details`);
  assert.equal(app.status, 200, JSON.stringify(app.body));
  const mine = app.body.ticket.attachments;
  assert.ok(mine.some((a) => a.file_name === 'mine.jpg' && a.uploader_desk === 'APPLICANT'));
  assert.ok(!mine.some((a) => a.file_name === 'n.pdf'), 'desk documents never reach the applicant');
  assert.ok(!JSON.stringify(app.body).includes(ae.name), 'no staff name in the applicant payload');
  assert.ok(mine.every((a) => a.uploader_name === undefined));
});
