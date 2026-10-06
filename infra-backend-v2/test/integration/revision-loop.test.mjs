// 0.6 / Issue 1: JE files a report with files, the AE sends it back, the JE
// refiles with new files -- three loops over real HTTP with multipart bodies.
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { call, stopServer, sampleJpeg, samplePdf } from './http-helpers.mjs';
import { TEMP_DIR, TICKETS_DIR } from '../../src/config/paths.js';
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
const ticket = async (id) => (await pool.query('SELECT * FROM mnt_tickets WHERE id = ?', [id]))[0][0];
const tempCount = () => (fs.existsSync(TEMP_DIR) ? fs.readdirSync(TEMP_DIR).length : 0);

function reportForm({ remarks, amount = '12000', nature = 'Fix the leak' } = {}) {
  const fd = new FormData();
  if (nature != null) fd.append('nature_of_work', nature);
  fd.append('estimated_amount', amount);
  if (remarks) fd.append('remarks', remarks);
  fd.append('site_photos', sampleJpeg());
  fd.append('estimate_docs', samplePdf());
  return fd;
}

test('three return / refile loops with files keep every version intact', async () => {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je = await makeUser({ role: 'JE' });
  const ae = await makeUser({ role: 'AE' });
  const id = await makeOpenTicket(applicant, je, 'ASSIGNED_TO_JE');
  ticketsToClean.push(id);
  await pool.query('UPDATE mnt_tickets SET current_desk_user_id = ?, assigned_ae_id = ? WHERE id = ?', [je, ae, id]);
  const [jeUid, aeUid] = [await uid(je), await uid(ae)];

  for (let loop = 1; loop <= 3; loop += 1) {
    const filed = await call(jeUid, 'POST', `/api/tickets/${id}/report`,
      reportForm(loop === 1 ? {} : { remarks: `Split the estimate (loop ${loop})` }));
    assert.equal(filed.status, 200, filed.text);
    assert.equal(filed.body.version, loop);
    assert.equal((await ticket(id)).status, 'PENDING_AE_APPROVAL');
    assert.equal((await ticket(id)).open_change_request_id, null, 'refile answers the open request');

    const [files] = await pool.query(
      'SELECT document_category, report_id FROM mnt_attachments WHERE ticket_id = ? AND report_id = ?', [id, filed.body.report_id]);
    assert.deepEqual(files.map((f) => f.document_category).sort(), ['JE_ESTIMATE_DOC', 'JE_SITE_PHOTO']);

    if (loop < 3) {
      const back = await call(aeUid, 'POST', `/api/tickets/${id}/actions`,
        { action: 'REQUEST_CHANGES', to_desk: 'JE', message: `Needs more detail ${loop}` });
      assert.equal(back.status, 200, back.text);
      const t = await ticket(id);
      assert.equal(t.status, 'RETURNED_TO_JE');
      assert.equal(t.current_desk_user_id, je);
      assert.ok(t.open_change_request_id);
    }
  }

  const [versions] = await pool.query('SELECT version FROM mnt_reports WHERE ticket_id = ? ORDER BY version', [id]);
  assert.deepEqual(versions.map((v) => v.version), [1, 2, 3]);
  const [perReport] = await pool.query(
    'SELECT report_id, COUNT(*) n FROM mnt_attachments WHERE ticket_id = ? AND report_id IS NOT NULL GROUP BY report_id', [id]);
  assert.equal(perReport.length, 3);
  assert.ok(perReport.every((r) => Number(r.n) === 2));

  const onDisk = fs.readdirSync(path.join(TICKETS_DIR, String(id), 'je_reports', 'site_photos'));
  assert.equal(onDisk.length, 3);
});

test('a refused refile leaves no file behind and the ticket where it was', async () => {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je = await makeUser({ role: 'JE' });
  const ae = await makeUser({ role: 'AE' });
  const id = await makeOpenTicket(applicant, je, 'ASSIGNED_TO_JE');
  ticketsToClean.push(id);
  await pool.query('UPDATE mnt_tickets SET current_desk_user_id = ?, assigned_ae_id = ? WHERE id = ?', [je, ae, id]);
  const [jeUid, aeUid] = [await uid(je), await uid(ae)];

  assert.equal((await call(jeUid, 'POST', `/api/tickets/${id}/report`, reportForm())).status, 200);
  assert.equal((await call(aeUid, 'POST', `/api/tickets/${id}/actions`,
    { action: 'REQUEST_CHANGES', to_desk: 'JE', message: 'Redo' })).status, 200);

  const before = tempCount();
  const noReply = await call(jeUid, 'POST', `/api/tickets/${id}/report`, reportForm()); // reply is mandatory
  assert.equal(noReply.status, 400);
  assert.equal(noReply.body.code, 'MESSAGE_REQUIRED');
  assert.ok(noReply.body.requestId, 'error body carries the request id');
  assert.equal(tempCount(), before, 'temp files removed');
  assert.equal((await ticket(id)).status, 'RETURNED_TO_JE');
  const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM mnt_attachments WHERE ticket_id = ?', [id]);
  assert.equal(Number(n), 2, 'only version 1 files exist');

  // A second submit of an already-filed report is refused, not duplicated.
  assert.equal((await call(jeUid, 'POST', `/api/tickets/${id}/report`, reportForm({ remarks: 'Done' }))).status, 200);
  const dup = await call(jeUid, 'POST', `/api/tickets/${id}/report`, reportForm({ remarks: 'Done again' }));
  assert.ok([403, 409].includes(dup.status));
});

test('JE desk: loose upload refused, .docx with empty MIME accepted, details tell the form what it needs', async () => {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je = await makeUser({ role: 'JE' });
  const ae = await makeUser({ role: 'AE' });
  const id = await makeOpenTicket(applicant, je, 'ASSIGNED_TO_JE');
  ticketsToClean.push(id);
  await pool.query('UPDATE mnt_tickets SET current_desk_user_id = ?, assigned_ae_id = ? WHERE id = ?', [je, ae, id]);
  const [jeUid, aeUid] = [await uid(je), await uid(ae)];

  // R1: the standalone upload card is not offered, and the API refuses it.
  const d0 = await call(jeUid, 'GET', `/api/tickets/${id}/details`);
  assert.equal(d0.body.ticket.can_upload, false);
  const loose = new FormData();
  loose.append('files', samplePdf());
  assert.equal((await call(jeUid, 'POST', `/api/tickets/${id}/attachments`, loose)).status, 403);

  // R6: .docx with an empty browser MIME type goes through; PK header present.
  const fd = reportForm();
  fd.set('estimate_docs', new File([Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])], 'estimate.docx', { type: '' }));
  assert.equal((await call(jeUid, 'POST', `/api/tickets/${id}/report`, fd)).status, 200);

  // A PDF that is not a PDF is refused with 415 and leaves nothing behind.
  await call(aeUid, 'POST', `/api/tickets/${id}/actions`, { action: 'REQUEST_CHANGES', to_desk: 'JE', message: 'Again' });
  const before = tempCount();
  const bad = reportForm({ remarks: 'Again' });
  bad.set('estimate_docs', new File([Buffer.from('<html>nope</html>')], 'estimate.pdf', { type: 'application/pdf' }));
  const refused = await call(jeUid, 'POST', `/api/tickets/${id}/report`, bad);
  assert.equal(refused.status, 415);
  assert.equal(tempCount(), before);

  // R8: the JE's details say a reply is required; the AE's FORWARD action does not.
  const d1 = await call(jeUid, 'GET', `/api/tickets/${id}/details`);
  const submit = d1.body.ticket.available_actions.actions.find((a) => a.action === 'SUBMIT_REPORT');
  assert.equal(submit.reply_required, true);
  assert.equal(submit.reply_to_desk, 'AE');
  // R3: report versions are listed, newest first.
  assert.deepEqual(d1.body.ticket.reports.map((r) => r.version), [1]);

  // Upload limits are served for the forms.
  const lim = await call(jeUid, 'GET', '/api/meta/upload-limits');
  assert.equal(lim.body.limits.report_photos, 10);
});
