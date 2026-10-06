// Issue 2: every desk can attach files to the move it makes, and each file
// records who attached it and with which movement.
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { call, stopServer, samplePdf, sampleJpeg } from './http-helpers.mjs';
import { TEMP_DIR, TICKETS_DIR } from '../../src/config/paths.js';
import { makeUser, makeOpenTicket, cleanup, pool } from './helpers.mjs';

const ticketsToClean = [];
let deactivated = [];
beforeEach(cleanup);
after(async () => {
  if (deactivated.length) await pool.query('UPDATE mnt_users SET is_active = TRUE WHERE id IN (?)', [deactivated]);
  for (const id of ticketsToClean) fs.rmSync(path.join(TICKETS_DIR, String(id)), { recursive: true, force: true });
  await cleanup();
  await stopServer();
  await pool.end();
});

const uid = async (id) => (await pool.query('SELECT firebase_uid FROM mnt_users WHERE id = ?', [id]))[0][0].firebase_uid;
const tempCount = () => (fs.existsSync(TEMP_DIR) ? fs.readdirSync(TEMP_DIR).length : 0);
const move = (fields, ...files) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  files.forEach((f) => fd.append('files', f));
  return fd;
};

// Real Dean/Director rows may exist (placeholders, seeded staff): park them so the test users hold those desks.
async function soleHolders() {
  const dean = await makeUser({ role: 'DEAN' });
  const director = await makeUser({ role: 'DIRECTOR' });
  const [others] = await pool.query(
    "SELECT id FROM mnt_users WHERE role IN ('DEAN','DIRECTOR') AND is_active = TRUE AND id NOT IN (?, ?)", [dean, director]);
  deactivated = others.map((r) => r.id);
  if (deactivated.length) await pool.query('UPDATE mnt_users SET is_active = FALSE WHERE id IN (?)', [deactivated]);
  return { dean, director };
}

test('each desk attaches a file going up and coming back; rows carry desk and movement', async () => {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je = await makeUser({ role: 'JE' });
  const ae = await makeUser({ role: 'AE', name: 'AE Person' });
  const se = await makeUser({ role: 'SE', name: 'SE Person' });
  const { dean, director } = await soleHolders();
  const id = await makeOpenTicket(applicant, je, 'PENDING_AE_APPROVAL');
  ticketsToClean.push(id);
  await pool.query('UPDATE mnt_tickets SET current_desk_user_id = ?, assigned_ae_id = ?, assigned_se_id = ? WHERE id = ?', [ae, ae, se, id]);
  const u = { ae: await uid(ae), se: await uid(se), dean: await uid(dean), director: await uid(director), je: await uid(je), applicant: await uid(applicant) };

  const act = (who, fields, ...files) => call(u[who], 'POST', `/api/tickets/${id}/actions`, move(fields, ...files));

  for (const who of ['ae', 'se', 'dean']) {
    const r = await act(who, { action: 'FORWARD' }, samplePdf(`${who}-up.pdf`));
    assert.equal(r.status, 200, r.text);
  }
  const back = [['director', 'DEAN'], ['dean', 'SE'], ['se', 'AE'], ['ae', 'JE']];
  for (const [who, to] of back) {
    const r = await act(who, { action: 'REQUEST_CHANGES', to_desk: to, message: `${who} wants changes` }, sampleJpeg(`${who}-down.jpg`));
    assert.equal(r.status, 200, r.text);
  }

  const [rows] = await pool.query(
    `SELECT a.uploader_desk, a.original_name, a.document_category, a.audit_log_id, l.action, l.from_desk, l.to_desk
       FROM mnt_attachments a JOIN mnt_audit_logs l ON l.id = a.audit_log_id WHERE a.ticket_id = ? ORDER BY a.id`, [id]);
  assert.deepEqual(rows.map((r) => r.uploader_desk), ['AE', 'SE', 'DEAN', 'DIRECTOR', 'DEAN', 'SE', 'AE']);
  assert.ok(rows.every((r) => r.document_category === 'DESK_DOC'));
  assert.deepEqual(rows.map((r) => r.action), ['FORWARDED', 'FORWARDED', 'FORWARDED', 'CHANGES_REQUESTED', 'CHANGES_REQUESTED', 'CHANGES_REQUESTED', 'CHANGES_REQUESTED']);
  assert.equal(rows[0].original_name, 'ae-up.pdf');
  assert.equal(rows[3].to_desk, 'DEAN');

  // AE (and above) see who attached each file and the movement.
  const aeView = (await call(u.ae, 'GET', `/api/tickets/${id}/details`)).body.ticket;
  const f = aeView.attachments.find((a) => a.file_name === 'dean-up.pdf');
  assert.equal(f.uploader_desk, 'DEAN');
  assert.ok(f.uploader_name);
  assert.equal(f.attached_with.action, 'FORWARDED');
  assert.equal(f.attached_with.to_desk, 'DIRECTOR');

  // The JE sees desks, not the names of higher desks.
  const jeView = (await call(u.je, 'GET', `/api/tickets/${id}/details`)).body.ticket;
  const jf = jeView.attachments.find((a) => a.file_name === 'dean-up.pdf');
  assert.equal(jf.uploader_desk, 'DEAN');
  assert.equal(jf.uploader_name, null);

  // The applicant gets no desk file and no attribution at all.
  const appView = (await call(u.applicant, 'GET', `/api/tickets/${id}/details`)).body.ticket;
  assert.equal(appView.attachments.length, 0);
});

test('restricted files stay with the desk and above; a refused action leaves nothing behind', async () => {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je = await makeUser({ role: 'JE' });
  const ae = await makeUser({ role: 'AE' });
  const se = await makeUser({ role: 'SE' });
  const other = await makeUser({ role: 'AE' });
  const id = await makeOpenTicket(applicant, je, 'PENDING_AE_APPROVAL');
  ticketsToClean.push(id);
  await pool.query('UPDATE mnt_tickets SET current_desk_user_id = ?, assigned_ae_id = ?, assigned_se_id = ? WHERE id = ?', [ae, ae, se, id]);
  const [aeUid, seUid, jeUid, otherUid] = [await uid(ae), await uid(se), await uid(je), await uid(other)];

  // Not this person's desk: 403, no row, no file, no temp leftovers.
  const before = tempCount();
  const refused = await call(otherUid, 'POST', `/api/tickets/${id}/actions`, move({ action: 'FORWARD' }, samplePdf('x.pdf')));
  assert.equal(refused.status, 403);
  assert.equal(tempCount(), before);
  assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM mnt_attachments WHERE ticket_id = ?', [id]))[0][0].n), 0);

  // A failing move (reply missing is not it; bad action payload) cleans up too.
  const bad = await call(aeUid, 'POST', `/api/tickets/${id}/actions`, move({ action: 'REQUEST_CHANGES', to_desk: 'JE' }, samplePdf('y.pdf')));
  assert.equal(bad.status, 400);
  assert.equal(tempCount(), before);

  // Restricted file: AE uploads, SE may read it, the JE may not.
  const ok = await call(aeUid, 'POST', `/api/tickets/${id}/actions`, move({ action: 'FORWARD', restricted_files: 'true' }, samplePdf('secret.pdf')));
  assert.equal(ok.status, 200, ok.text);
  const seView = (await call(seUid, 'GET', `/api/tickets/${id}/details`)).body.ticket;
  assert.ok(seView.attachments.some((a) => a.file_name === 'secret.pdf' && a.document_category === 'AUTHORITY_REMARKS'));
  const jeView = (await call(jeUid, 'GET', `/api/tickets/${id}/details`)).body.ticket;
  assert.equal(jeView.attachments.some((a) => a.file_name === 'secret.pdf'), false);

  // ASSIGN_JE takes no files.
  await pool.query("UPDATE mnt_tickets SET status = 'UNASSIGNED', current_desk_user_id = ? WHERE id = ?", [ae, id]);
  const assign = await call(aeUid, 'POST', `/api/tickets/${id}/actions`, move({ action: 'ASSIGN_JE', assignee_id: String(je) }, samplePdf('z.pdf')));
  assert.equal(assign.status, 400);
});
