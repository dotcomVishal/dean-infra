// Master-plan Phase 7 over real HTTP: guard rails, the tombstone, all seven child tables, the files.
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { call, stopServer } from './http-helpers.mjs';
import { TICKETS_DIR, TRASH_DIR } from '../../src/config/paths.js';
import { purgeTrash, CHILD_TABLES } from '../../src/services/ticketDeletion.js';
import { makeUser, makeOpenTicket, cleanup, pool } from './helpers.mjs';

const toClean = [];
beforeEach(cleanup);
after(async () => {
  for (const id of toClean) fs.rmSync(path.join(TICKETS_DIR, String(id)), { recursive: true, force: true });
  for (const name of fs.existsSync(TRASH_DIR) ? fs.readdirSync(TRASH_DIR) : []) {
    if (toClean.some((id) => name.startsWith(`${id}-`))) fs.rmSync(path.join(TRASH_DIR, name), { recursive: true, force: true });
  }
  await pool.query('DELETE FROM deleted_tickets WHERE ticket_id IN (?)', [toClean.length ? toClean : [0]]);
  await cleanup();
  await stopServer();
  await pool.end();
});

const uid = async (id) => (await pool.query('SELECT firebase_uid FROM users WHERE id = ?', [id]))[0][0].firebase_uid;
const ref = (id) => `TKT-${String(id).padStart(4, '0')}`;
const rowsLeft = async (id) => {
  const out = {};
  for (const t of CHILD_TABLES) out[t] = Number((await pool.query(`SELECT COUNT(*) n FROM ${t} WHERE ticket_id = ?`, [id]))[0][0].n);
  out.tickets = Number((await pool.query('SELECT COUNT(*) n FROM tickets WHERE id = ?', [id]))[0][0].n);
  return out;
};

// A ticket with something in every child table, plus files on disk.
async function fullTicket({ financial = true } = {}) {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je = await makeUser({ role: 'JE' });
  const admin = await makeUser({ role: 'SYSADMIN', name: 'Delete Admin' });
  const id = await makeOpenTicket(applicant, je, 'WORK_IN_PROGRESS');
  toClean.push(id);

  const [audit] = await pool.query("INSERT INTO audit_logs (ticket_id, user_id, action, remarks) VALUES (?, ?, 'CREATED', 'ci')", [id, applicant]);
  const [msg] = await pool.query(
    `INSERT INTO ticket_messages (ticket_id, audit_log_id, author_user_id, author_desk, kind, body, visible_from_rank)
     VALUES (?, ?, ?, 'JE', 'PUBLIC_NOTE', 'hello', 0)`, [id, audit.insertId, je]);
  const [rep] = await pool.query(
    "INSERT INTO reports (ticket_id, je_id, version, nature_of_work, estimated_amount, answers_message_id) VALUES (?, ?, 1, 'w', 100, ?)", [id, je, msg.insertId]);
  const dir = path.join(TICKETS_DIR, String(id), 'applicant_evidence');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1-2-photo.jpg'), 'x');
  await pool.query(
    `INSERT INTO attachments (ticket_id, file_url, uploaded_by, document_category, report_id, audit_log_id)
     VALUES (?, ?, ?, 'APPLICANT_EVIDENCE', ?, ?)`, [id, `/uploads/tickets/${id}/applicant_evidence/1-2-photo.jpg`, applicant, rep.insertId, audit.insertId]);
  await pool.query(
    "INSERT INTO tenders (ticket_id, nit_number, portal_type, status, work_order_value, awarded_agency, created_by) VALUES (?, 'N', 'GeM', ?, ?, 'ABC', ?)",
    [id, financial ? 'AWARDED' : 'PUBLISHED', financial ? 80 : null, je]);
  if (financial) {
    await pool.query(
      "INSERT INTO bills (ticket_id, bill_number, agency_name, gross_amount, net_amount, processed_by) VALUES (?, 'B1', 'ABC', 50, 45, ?)", [id, admin]);
  }
  await pool.query(
    "INSERT INTO notifications (ticket_id, to_user_id, kind, subject, body, next_due_at) VALUES (?, ?, 'REMINDER', 's', 'b', NOW())", [id, je]);
  return { id, tokens: { admin: await uid(admin), je: await uid(je) }, adminId: admin };
}

const del = (token, id, body) => call(token, 'DELETE', `/api/admin/tickets/${id}`, body);

test('guard rails: validation, wrong confirmation, role, missing ticket, financial records need force', async () => {
  const { id, tokens } = await fullTicket();
  const before = await rowsLeft(id);

  assert.equal((await del(tokens.admin, id, { reason: 'short', confirm: ref(id) })).status, 400);
  const wrong = await del(tokens.admin, id, { reason: 'Duplicate of another ticket', confirm: 'TKT-9999' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.code, 'CONFIRMATION_MISMATCH');
  assert.equal((await del(tokens.je, id, { reason: 'Duplicate of another ticket', confirm: ref(id) })).status, 403);
  assert.equal((await del(tokens.admin, 999999999, { reason: 'Duplicate of another ticket', confirm: ref(999999999) })).status, 404);

  const noForce = await del(tokens.admin, id, { reason: 'Duplicate of another ticket', confirm: ref(id) });
  assert.equal(noForce.status, 409);
  assert.equal(noForce.body.code, 'FINANCIAL_RECORDS');
  assert.deepEqual(await rowsLeft(id), before, 'nothing was removed');
  assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM deleted_tickets WHERE ticket_id = ?', [id]))[0][0].n), 0, 'no tombstone for a refused delete');
});

test('preview lists what would be removed and flags money', async () => {
  const { id, tokens } = await fullTicket();
  const r = await call(tokens.admin, 'GET', `/api/admin/tickets/${id}/delete-preview`);
  assert.equal(r.status, 200);
  assert.equal(r.body.ticket_ref, ref(id));
  assert.equal(r.body.financial, true);
  assert.deepEqual(Object.keys(r.body.counts).sort(), [...CHILD_TABLES].sort());
  assert.equal(r.body.counts.bills, 1);
});

test('delete with force: all seven tables empty, one tombstone, files in trash', async () => {
  const { id, tokens, adminId } = await fullTicket();
  const r = await del(tokens.admin, id, { reason: 'Test data created by mistake', confirm: ref(id).toLowerCase(), force: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.files_moved_to_trash, true);

  assert.deepEqual(await rowsLeft(id), {
    bills: 0, tenders: 0, attachments: 0, notifications: 0, reports: 0, ticket_messages: 0, audit_logs: 0, tickets: 0,
  });

  const [tomb] = await pool.query('SELECT * FROM deleted_tickets WHERE ticket_id = ?', [id]);
  assert.equal(tomb.length, 1);
  assert.equal(tomb[0].deleted_by, adminId);
  assert.equal(tomb[0].deleted_by_name, 'Delete Admin');
  assert.equal(tomb[0].reason, 'Test data created by mistake');
  const snap = typeof tomb[0].snapshot === 'string' ? JSON.parse(tomb[0].snapshot) : tomb[0].snapshot;
  assert.equal(snap.ticket.id, id);
  assert.deepEqual([snap.row_counts.reports, snap.row_counts.bills, snap.row_counts.ticket_messages], [1, 1, 1]);
  assert.equal(Number(snap.estimate), 100);
  assert.equal(Number(snap.award_amount), 80);
  assert.equal(snap.bill_totals.net, 45);
  assert.deepEqual(snap.file_names, ['1-2-photo.jpg']);
  assert.equal(tomb[0].file_count, 1);

  assert.equal(fs.existsSync(path.join(TICKETS_DIR, String(id))), false, 'folder left the ticket area');
  const trashed = fs.readdirSync(TRASH_DIR).filter((n) => n.startsWith(`${id}-`));
  assert.equal(trashed.length, 1);
  assert.ok(fs.existsSync(path.join(TRASH_DIR, trashed[0], 'applicant_evidence', '1-2-photo.jpg')));

  // The list the Sysadmin reads.
  const list = await call(tokens.admin, 'GET', '/api/admin/deleted-tickets');
  const mine = list.body.deleted.find((d) => d.ticket_id === id);
  assert.equal(mine.reason, 'Test data created by mistake');
  assert.equal(await call(tokens.je, 'GET', '/api/admin/deleted-tickets').then((x) => x.status), 403);

  // The trash is purged after 30 days, and not before.
  assert.equal(purgeTrash({ now: Date.now() + 29 * 86400e3 }), 0);
  assert.ok(purgeTrash({ now: Date.now() + 31 * 86400e3 }) >= 1);
  assert.equal(fs.readdirSync(TRASH_DIR).filter((n) => n.startsWith(`${id}-`)).length, 0);
});

test('a ticket with no money deletes without force', async () => {
  const { id, tokens } = await fullTicket({ financial: false });
  const r = await del(tokens.admin, id, { reason: 'Raised twice by the applicant', confirm: ref(id) });
  assert.equal(r.status, 200, r.text);
  assert.equal((await rowsLeft(id)).tickets, 0);
});

test('a missing cascade rule cannot leave rows behind: the explicit deletes still clear every table', async () => {
  const { id, tokens } = await fullTicket();
  const conn = await pool.getConnection();
  try {
    const [[fk]] = await conn.query(
      `SELECT CONSTRAINT_NAME AS name FROM information_schema.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'bills' AND REFERENCED_TABLE_NAME = 'tickets'`);
    await conn.query(`ALTER TABLE bills DROP FOREIGN KEY ${fk.name}`);
    await conn.query(`ALTER TABLE bills ADD CONSTRAINT ${fk.name} FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE RESTRICT`);
    try {
      const r = await del(tokens.admin, id, { reason: 'Deleting with a broken rule', confirm: ref(id), force: true });
      assert.equal(r.status, 200, r.text);
      assert.deepEqual(await rowsLeft(id), {
        bills: 0, tenders: 0, attachments: 0, notifications: 0, reports: 0, ticket_messages: 0, audit_logs: 0, tickets: 0,
      });
    } finally {
      await conn.query(`ALTER TABLE bills DROP FOREIGN KEY ${fk.name}`);
      await conn.query(`ALTER TABLE bills ADD CONSTRAINT ${fk.name} FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE`);
    }
  } finally { conn.release(); }
});
