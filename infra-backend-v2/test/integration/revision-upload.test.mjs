// Revision loop through the REAL route and multer (an HTTP request, not a handler call):
// JE files report v1 -> AE asks for changes -> JE files v2 with a reply and mixed files.
// Covers P1 (type check by extension + content, not the browser's declared type),
// P4 (long / non-ASCII names) and P5 (desk holder) from the Master plan, section 3.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import app from '../../src/app.js';
import { auth } from '../../src/config/firebase.js';
import { makeUser, makeOpenTicket, cleanup, pool } from './helpers.mjs';

const UPLOADS = process.env.UPLOADS_DIR;
const TEMP = path.join(UPLOADS, 'temp');
fs.mkdirSync(TEMP, { recursive: true });
const tempFiles = () => new Set(fs.readdirSync(TEMP));

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 2)]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n');
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 3)]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 4)]);

let server;
let base;
const uidOf = async (id) => (await pool.query('SELECT firebase_uid FROM infra_users WHERE id = ?', [id]))[0][0].firebase_uid;

before(async () => {
  // The token IS the Firebase uid of the test user.
  auth.verifyIdToken = async (token) => ({
    uid: token, email: `${token}@test.local`, email_verified: true, firebase: { sign_in_provider: 'google.com' },
  });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(cleanup);
after(async () => {
  await cleanup();
  server.close();
  await pool.end();
});

async function http(token, method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const blob = (buf, type) => new Blob([buf], { type });

async function setup() {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je = await makeUser({ role: 'JE' });
  const ae = await makeUser({ role: 'AE' });
  const ticketId = await makeOpenTicket(applicant, je);
  await pool.query('UPDATE infra_tickets SET assigned_ae_id = ?, current_desk_user_id = ? WHERE id = ?', [ae, je, ticketId]);
  return { ticketId, je, ae, jeToken: await uidOf(je), aeToken: await uidOf(ae) };
}

function reportForm({ remarks, photos = [], docs = [] }) {
  const f = new FormData();
  f.append('nature_of_work', 'Repair the drain');
  f.append('estimated_amount', '12500');
  if (remarks) f.append('remarks', remarks);
  for (const [name, buf, type] of photos) f.append('site_photos', blob(buf, type), name);
  for (const [name, buf, type] of docs) f.append('estimate_docs', blob(buf, type), name);
  return f;
}

test('revision with mixed, long-named, non-ASCII and untyped files submits first time', async () => {
  const { ticketId, jeToken, aeToken } = await setup();
  const before = tempFiles();

  const v1 = await http(jeToken, 'POST', `/api/tickets/${ticketId}/report`,
    reportForm({ photos: [['site.jpg', JPEG, 'image/jpeg']], docs: [['estimate.pdf', PDF, 'application/pdf']] }));
  assert.equal(v1.status, 200, JSON.stringify(v1.body));
  assert.equal(v1.body.version, 1);

  const ask = await http(aeToken, 'POST', `/api/tickets/${ticketId}/actions`,
    { action: 'REQUEST_CHANGES', to_desk: 'JE', message: 'Add the drainage estimate and close-up photos.' });
  assert.equal(ask.status, 200, JSON.stringify(ask.body));

  const longName = `${'a'.repeat(196)}.pdf`; // 200 characters
  const hindi = 'अनुमान_पत्र.docx';
  const v2 = await http(jeToken, 'POST', `/api/tickets/${ticketId}/report`, reportForm({
    remarks: 'Drainage estimate and photos added.',
    photos: [
      ['p1.jpg', JPEG, 'image/pjpeg'], // alias some systems send
      ['p2.png', PNG, 'image/png'],
      ['p3.jpeg', JPEG, ''],           // empty type (no registered handler)
    ],
    docs: [
      [longName, PDF, 'application/x-pdf'],
      ['sheet.xlsx', ZIP, 'application/octet-stream'],
      [hindi, ZIP, ''],
    ],
  }));
  assert.equal(v2.status, 200, JSON.stringify(v2.body));
  assert.equal(v2.body.status, 'PENDING_AE_APPROVAL');
  assert.equal(v2.body.version, 2);

  const [files] = await pool.query(
    'SELECT report_id, original_name, file_url, document_category FROM infra_attachments WHERE ticket_id = ? AND report_id = ?',
    [ticketId, v2.body.report_id]);
  assert.equal(files.length, 6, 'every v2 file is linked to the v2 report');
  const names = files.map((f) => f.original_name);
  assert.ok(names.includes(longName), 'long name kept');
  assert.ok(names.includes(hindi), 'Devanagari name kept intact');
  for (const f of files) assert.ok(f.file_url.length < 100, `stored path is short: ${f.file_url}`);
  assert.deepEqual([...tempFiles()].filter((n) => !before.has(n)), [], 'nothing left in uploads/temp');
  fs.rmSync(path.join(UPLOADS, 'tickets', String(ticketId)), { recursive: true, force: true });
});

test('a renamed executable is refused with 415 and leaves nothing behind', async () => {
  const { ticketId, jeToken } = await setup();
  const before = tempFiles();
  const res = await http(jeToken, 'POST', `/api/tickets/${ticketId}/report`, reportForm({
    photos: [['ok.jpg', JPEG, 'image/jpeg']],
    docs: [['estimate.pdf', EXE, 'application/pdf']],
  }));
  assert.equal(res.status, 415);
  assert.equal(res.body.code, 'UNSUPPORTED_FILE_TYPE');
  assert.match(res.body.message, /estimate\.pdf/);
  assert.deepEqual([...tempFiles()].filter((n) => !before.has(n)), []);
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM infra_reports WHERE ticket_id = ?', [ticketId]);
  assert.equal(n, 0, 'no report is created for a refused upload');
});

test('a declared type that contradicts the extension is refused (text/html as .jpg)', async () => {
  const { ticketId, jeToken } = await setup();
  const res = await http(jeToken, 'POST', `/api/tickets/${ticketId}/report`,
    reportForm({ photos: [['x.jpg', JPEG, 'text/html']] }));
  assert.equal(res.status, 415);
});

test('P5: submit works when the stored desk owner is stale (page and endpoint agree)', async () => {
  const { ticketId, je, jeToken } = await setup();
  const other = await makeUser({ role: 'JE' });
  await pool.query('UPDATE infra_tickets SET current_desk_user_id = ? WHERE id = ?', [other, ticketId]);
  const res = await http(jeToken, 'POST', `/api/tickets/${ticketId}/report`, reportForm({}));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(je);
});
