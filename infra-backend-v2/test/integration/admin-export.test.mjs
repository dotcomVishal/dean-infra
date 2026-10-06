// Phase 6 over real HTTP: list filters, CSV export equals the list, access control,
// invalid filters, formula guard, and the priority override.
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { call, stopServer } from './http-helpers.mjs';
import { makeUser, cleanup, pool } from './helpers.mjs';

beforeEach(cleanup);
after(async () => { await cleanup(); await stopServer(); await pool.end(); });

const uid = async (id) => (await pool.query('SELECT firebase_uid FROM mnt_users WHERE id = ?', [id]))[0][0].firebase_uid;

async function seed() {
  const applicant = await makeUser({ role: 'APPLICANT', name: 'Export Applicant' });
  const je = await makeUser({ role: 'JE', name: 'Export JE' });
  const admin = await makeUser({ role: 'SYSADMIN' });
  const mk = async (fields) => {
    const [r] = await pool.query(
      `INSERT INTO mnt_tickets (applicant_id, assigned_je_id, department, campus, title, description, landmark, location, status, priority, created_at)
       VALUES (?, ?, ?, ?, ?, 'ci description, with comma', 'Near gate', 'Near gate', ?, ?, ?)`,
      [applicant, je, fields.department, fields.campus, fields.title, fields.status, fields.priority ?? 'NORMAL', fields.created]);
    return r.insertId;
  };
  const ids = {
    a: await mk({ department: 'Civil', campus: 'NORTH', title: 'ci-export alpha', status: 'ASSIGNED_TO_JE', created: '2026-03-10 10:00:00' }),
    b: await mk({ department: 'Civil', campus: 'SOUTH', title: 'ci-export, "quoted"', status: 'CLOSED', priority: 'URGENT', created: '2026-03-11 10:00:00' }),
    c: await mk({ department: 'Electrical', campus: 'NORTH', title: '=cmd|calc', status: 'DENIED', created: '2026-03-12 10:00:00' }),
    d: await mk({ department: 'Electrical', campus: 'SOUTH', title: 'ci-export delta', status: 'CLOSED', created: '2026-03-12 20:00:00' }),
  };
  await pool.query('UPDATE mnt_tickets SET is_mock = FALSE WHERE id IN (?)', [Object.values(ids)]);
  return { ids, tokens: { admin: await uid(admin), je: await uid(je), applicant: await uid(applicant) } };
}
const cleanTickets = (ids) => pool.query('DELETE FROM mnt_tickets WHERE id IN (?)', [Object.values(ids)]);
const qs = (o) => new URLSearchParams(o).toString();
const parseCsv = (text) => text.replace(/^﻿/, '').trim().split(/\r\n/);

test('list filters: campus, several statuses, date range; invalid values are a 400', async () => {
  const { ids, tokens } = await seed();
  try {
    const list = async (q) => (await call(tokens.admin, 'GET', `/api/admin/tickets?${qs({ search: 'ci-export', ...q })}&limit=100`));
    const idsOf = (r) => r.body.tickets.map((t) => t.id).sort((x, y) => x - y);
    const mine = Object.values(ids).sort((x, y) => x - y);

    assert.equal((await list({})).body.total >= 3, true);
    assert.deepEqual(idsOf(await list({ campus: 'SOUTH' })), [ids.b, ids.d].sort((x, y) => x - y));
    const wide = async (q) => (await call(tokens.admin, 'GET', `/api/admin/tickets?${qs(q)}&limit=200`)).body.tickets
      .map((t) => t.id).filter((i) => mine.includes(i)).sort((x, y) => x - y);
    assert.deepEqual(await wide({ status: 'CLOSED,DENIED', campus: 'NORTH' }), [ids.c]);
    assert.deepEqual(await wide({ status: 'CLOSED,DENIED' }), [ids.b, ids.c, ids.d].sort((x, y) => x - y));
    assert.deepEqual(idsOf(await list({ priority: 'URGENT' })), [ids.b]);
    assert.deepEqual(idsOf(await list({ department: 'Electrical', status: 'CLOSED' })), [ids.d]);
    // 12 Mar 00:00 IST .. 12 Mar 23:59 IST: the 10:00 UTC and 20:00 UTC tickets of that day (20:00 UTC is 01:30 IST on the 13th).
    const day = await call(tokens.admin, 'GET', `/api/admin/tickets?${qs({ created_from: '2026-03-12', created_to: '2026-03-12' })}&limit=100&search=`);
    assert.deepEqual(day.body.tickets.filter((t) => mine.includes(t.id)).map((t) => t.id), [ids.c]);

    const invalid = await call(tokens.admin, 'GET', `/api/admin/tickets?${qs({ status: 'BANANA' })}`);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, 'INVALID_FILTER');
  } finally { await cleanTickets(ids); }
});

test('export: same rows as the list, quoting, formula guard, BOM, filename; non-Sysadmin 403', async () => {
  const { ids, tokens } = await seed();
  try {
    const q = { search: 'ci-export', department: 'Civil' };
    const list = await call(tokens.admin, 'GET', `/api/admin/tickets?${qs(q)}&limit=100`);
    const csv = await call(tokens.admin, 'GET', `/api/admin/tickets/export?${qs(q)}`);
    assert.equal(csv.status, 200, csv.text.slice(0, 200));
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(csv.headers.get('content-disposition'), /attachment; filename="tickets_\d{8}_\d{4}\.csv"/);
    assert.ok(csv.text.startsWith('﻿'));

    const lines = parseCsv(csv.text);
    assert.equal(lines.length - 1, list.body.total, 'export rows equal the list total');
    assert.ok(lines[0].startsWith('Ticket no,Created (IST),Title,'));
    assert.ok(lines.some((l) => l.includes('"ci-export, ""quoted"""')), 'quotes and commas are escaped');
    assert.ok(lines.some((l) => l.includes('TKT-') && l.includes('2026-03-10 15:30')), 'created is shown in IST (10:00 UTC = 15:30)');

    // Formula guard on a user-typed title.
    const evil = await call(tokens.admin, 'GET', `/api/admin/tickets/export?${qs({ search: 'cmd', include_mock: '0' })}`);
    assert.ok(evil.text.includes("'=cmd|calc"), 'formula title is neutralised');
    assert.ok(!/(^|,)=cmd/.test(evil.text));

    assert.equal((await call(tokens.je, 'GET', '/api/admin/tickets/export')).status, 403);
    assert.equal((await call(tokens.applicant, 'GET', '/api/admin/tickets')).status, 403);
    assert.equal((await call(tokens.admin, 'GET', `/api/admin/tickets/export?${qs({ campus: 'MOON' })}`)).status, 400);
  } finally { await cleanTickets(ids); }
});

test('priority can be set through the override form; a bad value is refused', async () => {
  const { ids, tokens } = await seed();
  try {
    const set = (priority) => call(tokens.admin, 'POST', `/api/admin/tickets/${ids.a}/override`, { priority, remarks: 'ci priority' });
    assert.equal((await set('URGENT')).status, 200);
    assert.equal((await pool.query('SELECT priority FROM mnt_tickets WHERE id = ?', [ids.a]))[0][0].priority, 'URGENT');
    assert.equal((await set('HIGHEST')).status, 400);
    const [[log]] = await pool.query("SELECT remarks FROM mnt_audit_logs WHERE ticket_id = ? AND action = 'OVERRIDE' ORDER BY id DESC LIMIT 1", [ids.a]);
    assert.match(log.remarks, /Priority changed from NORMAL to URGENT/);
  } finally { await cleanTickets(ids); }
});
