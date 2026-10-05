// Master-plan Phase 4 against a real MySQL: who is mailed, JE reassignment mails,
// no reminders for any desk but the JE, and the weekly digest being duplicate-safe.
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { overrideTicketStatus, previewDigest } from '../../src/controllers/adminController.js';
import { performTicketAction } from '../../src/controllers/actionController.js';
import { createTicket } from '../../src/controllers/ticketController.js';
import { queueWeeklyDigests, loadDigestData } from '../../src/cron/weeklyDigest.js';
import { makeUser, makeOpenTicket, putOnLeave, cleanup, pool } from './helpers.mjs';

beforeEach(cleanup);
after(async () => { await cleanup(); await pool.end(); });

const fakeRes = () => {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const mails = async (ticketId) => (await pool.query(
  'SELECT to_user_id, kind, desk, subject FROM notifications WHERE ticket_id = ? ORDER BY id', [ticketId]))[0];
const override = async (admin, ticketId, body) => {
  const res = fakeRes();
  await overrideTicketStatus({ user: { id: admin, name: 'CI Admin' }, params: { ticket_id: String(ticketId) }, body }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
};
const civilScope = (userId) =>
  pool.query("INSERT INTO user_scopes (user_id, department, campus) VALUES (?, 'Civil', 'NORTH')", [userId]);

test('reassigning the JE at a JE stage mails the old JE and the new JE, and restarts the series for the new one', async () => {
  const admin = await makeUser({ role: 'SYSADMIN' });
  const applicant = await makeUser({ role: 'APPLICANT' });
  const oldJe = await makeUser({ role: 'JE' }); await civilScope(oldJe);
  const newJe = await makeUser({ role: 'JE' }); await civilScope(newJe);
  const id = await makeOpenTicket(applicant, oldJe, 'ASSIGNED_TO_JE');
  await pool.query('UPDATE tickets SET current_desk_user_id = ? WHERE id = ?', [oldJe, id]);

  await override(admin, id, { remarks: 'cover', reassign: { desk: 'JE', user_id: newJe } });
  const rows = await mails(id);
  assert.deepEqual(rows.map((r) => `${r.to_user_id}/${r.kind}`).sort(), [`${newJe}/REMINDER`, `${oldJe}/EMAIL`].sort());
  assert.match(rows.find((r) => r.to_user_id === oldJe).subject, /Reassigned$/);
  assert.match(rows.find((r) => r.to_user_id === newJe).subject, /Assigned to you$/);

  // Same JE again: no mail at all.
  const before = (await mails(id)).length;
  await override(admin, id, { remarks: 'again', reassign: { desk: 'JE', user_id: newJe } });
  assert.equal((await mails(id)).length, before);
});

test('reassigning the JE at a non-JE stage still mails both, with no reminder series', async () => {
  const admin = await makeUser({ role: 'SYSADMIN' });
  const applicant = await makeUser({ role: 'APPLICANT' });
  const oldJe = await makeUser({ role: 'JE' }); await civilScope(oldJe);
  const newJe = await makeUser({ role: 'JE' }); await civilScope(newJe);
  const ae = await makeUser({ role: 'AE' }); await civilScope(ae);
  const id = await makeOpenTicket(applicant, oldJe, 'PENDING_AE_APPROVAL');
  await pool.query('UPDATE tickets SET current_desk_user_id = ?, assigned_ae_id = ? WHERE id = ?', [ae, ae, id]);

  await override(admin, id, { remarks: 'swap', reassign: { desk: 'JE', user_id: newJe } });
  const rows = await mails(id);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.kind === 'EMAIL'));
  assert.deepEqual(rows.map((r) => r.to_user_id).sort(), [oldJe, newJe].sort());
});

test('a ticket with no available JE mails the AE once and starts no reminder series', async () => {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const ae = await makeUser({ role: 'AE' }); await civilScope(ae);
  const [jes] = await pool.query(
    "SELECT DISTINCT u.id FROM users u JOIN user_scopes s ON s.user_id = u.id WHERE u.role = 'JE' AND u.is_active = TRUE AND s.department = 'Civil' AND s.campus IN ('NORTH','BOTH')");
  for (const j of jes) await putOnLeave(j.id, ae);
  const res = fakeRes();
  await createTicket({
    user: { id: applicant, role: 'APPLICANT', name: 'CI A', email: 'a@test.local' },
    body: { department: 'Civil', campus: 'NORTH', description: 'x', landmark: 'gate', contact_phone: '9999999999' },
  }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const id = res.body.ticket_id;
  try {
    assert.equal(res.body.status, 'UNASSIGNED');
    const rows = await mails(id);
    assert.deepEqual(rows.map((r) => r.kind).sort(), ['EMAIL', 'EMAIL']);          // AE arrival + applicant "received"
    assert.equal(rows.filter((r) => r.kind === 'REMINDER').length, 0);
    assert.ok(rows.some((r) => /Needs a JE$/.test(r.subject)));
    assert.ok(rows.some((r) => /Received$/.test(r.subject)));
  } finally {
    await pool.query('DELETE FROM tickets WHERE id = ?', [id]);
    await pool.query('DELETE FROM user_availability WHERE created_by = ?', [ae]);
  }
});

test('forwarding to the Director mails nobody; forwarding to the Dean mails them once', async () => {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je = await makeUser({ role: 'JE' });
  const se = await makeUser({ role: 'SE' });
  const dean = await makeUser({ role: 'DEAN' });
  const director = await makeUser({ role: 'DIRECTOR' });
  const [others] = await pool.query(
    "SELECT id FROM users WHERE role IN ('DEAN','DIRECTOR') AND is_active = TRUE AND id NOT IN (?, ?)", [dean, director]);
  if (others.length) await pool.query('UPDATE users SET is_active = FALSE WHERE id IN (?)', [others.map((r) => r.id)]);
  try {
    const id = await makeOpenTicket(applicant, je, 'PENDING_SE_APPROVAL');
    await pool.query('UPDATE tickets SET current_desk_user_id = ?, assigned_se_id = ? WHERE id = ?', [se, se, id]);
    const act = async (user, body) => {
      const res = fakeRes();
      await performTicketAction({ user, params: { ticket_id: String(id) }, body }, res);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    };
    await act({ id: se, role: 'SE' }, { action: 'FORWARD' });
    assert.deepEqual((await mails(id)).map((r) => r.to_user_id), [dean]);
    await act({ id: dean, role: 'DEAN' }, { action: 'FORWARD' });
    assert.deepEqual((await mails(id)).map((r) => r.to_user_id), [dean], 'the Director is not mailed');
  } finally {
    if (others.length) await pool.query('UPDATE users SET is_active = TRUE WHERE id IN (?)', [others.map((r) => r.id)]);
  }
});

test('weekly digest: one row per user per week, empty digests skipped, preview sends nothing', async () => {
  const applicant = await makeUser({ role: 'APPLICANT' });
  const je = await makeUser({ role: 'JE' });
  const ae = await makeUser({ role: 'AE' }); await civilScope(ae);
  const idle = await makeUser({ role: 'AE' }); // nothing to report
  const id = await makeOpenTicket(applicant, je, 'PENDING_AE_APPROVAL');
  await pool.query('UPDATE tickets SET current_desk_user_id = ?, assigned_ae_id = ?, status_changed_at = NOW() - INTERVAL 9 DAY WHERE id = ?', [ae, ae, id]);

  const now = new Date();
  const first = await queueWeeklyDigests({ now });
  const second = await queueWeeklyDigests({ now });
  assert.ok(first.queued >= 1);
  assert.equal(second.queued, 0, 'second pass in the same week queues nothing');

  const [rows] = await pool.query("SELECT to_user_id, subject, body FROM notifications WHERE kind = 'DIGEST' AND to_user_id IN (?, ?)", [ae, idle]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].to_user_id, ae);
  assert.match(rows[0].subject, /^\[Infra\] Weekly summary, /);
  assert.match(rows[0].body, /Awaiting your review: 1/);
  assert.match(rows[0].body, new RegExp(`TKT-${String(id).padStart(4, '0')}, 9 days, awaiting your review`));

  const data = await loadDigestData(pool, { id: idle, role: 'AE' });
  assert.ok(data.counts.every(([, n]) => n === 0));

  const res = fakeRes();
  const before = (await pool.query("SELECT COUNT(*) n FROM notifications WHERE kind = 'DIGEST'"))[0][0].n;
  await previewDigest({ query: { user_id: String(ae) } }, res);
  assert.equal(res.body.empty, false);
  assert.match(res.body.body, /Awaiting your review: 1/);
  assert.equal((await pool.query("SELECT COUNT(*) n FROM notifications WHERE kind = 'DIGEST'"))[0][0].n, before);
});
