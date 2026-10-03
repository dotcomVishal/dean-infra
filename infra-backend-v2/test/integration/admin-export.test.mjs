// The Sysadmin list and its CSV export: same filter, same ids; injection neutralised; others refused.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import app from '../../src/app.js';
import { auth } from '../../src/config/firebase.js';
import { makeUser, makeOpenTicket, cleanup, pool } from './helpers.mjs';

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
after(async () => { await cleanup(); server.closeAllConnections?.(); server.close(); await pool.end(); });

const uidOf = async (id) => (await pool.query('SELECT firebase_uid FROM infra_users WHERE id = ?', [id]))[0][0].firebase_uid;
const get = (token, url) => fetch(base + url, { headers: { Authorization: `Bearer ${token}` } });

/** Minimal RFC 4180 reader, enough for the export. */
function parseCsv(text) {
  const rows = [];
  let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 1; } else cell += c;
  }
  return rows;
}

async function seed() {
  const admin = await makeUser({ role: 'SYSADMIN' });
  const applicant = await makeUser({ role: 'APPLICANT', name: 'Asha, "A" Rao' });
  const je = await makeUser({ role: 'JE' });
  const mk = async (status, fields = {}) => {
    const id = await makeOpenTicket(applicant, je, status);
    const set = { campus: 'NORTH', department: 'Civil', priority: 'NORMAL', ...fields };
    await pool.query('UPDATE infra_tickets SET ? WHERE id = ?', [set, id]);
    return id;
  };
  const t = {
    north: await mk('ASSIGNED_TO_JE', { title: 'North leak' }),
    south: await mk('PENDING_SE_APPROVAL', { campus: 'SOUTH', department: 'Electrical', priority: 'URGENT', title: 'South wiring' }),
    inject: await mk('WORK_COMPLETED', { title: '=HYPERLINK("http://evil","x")', resolution_kind: 'COMPLETED', resolved_at: new Date() }),
    back: await mk('ASSIGNED_TO_JE', { title: 'Sent back one', applicant_sent_back_at: new Date(), reopen_count: 1 }),
    old: await mk('CLOSED', { title: 'Old closed', created_at: new Date('2026-01-10T20:00:00Z') }), // 11 Jan, 01:30 IST
    mock: await mk('ASSIGNED_TO_JE', { title: 'Test ticket', is_mock: 1 }),
    gone: await mk('ASSIGNED_TO_JE', { title: 'Deleted one', deleted_at: new Date() }),
  };
  await pool.query('INSERT INTO infra_tenders (ticket_id, status, award_amount, awarded_agency, created_by) VALUES (?, ?, ?, ?, ?)', [t.north, 'AWARDED', 125000.5, 'ABC', je]);
  return { token: await uidOf(admin), applicantToken: await uidOf(applicant), t };
}

const FILTERS = [
  '', 'campus=SOUTH', 'status=ASSIGNED_TO_JE,CLOSED', 'department=Electrical', 'priority=URGENT',
  'from=2026-01-11&to=2026-01-11', 'awaiting_confirmation=1', 'sent_back=1', 'include_mock=1', 'include_deleted=1',
  'include_mock=1&include_deleted=1', 'search=leak',
];

test('the list and the CSV return the same ids for several filter combinations', async () => {
  const { token, t } = await seed();
  const mine = new Set(Object.values(t));
  for (const q of FILTERS) {
    const list = await (await get(token, `/api/admin/tickets?limit=200&${q}`)).json();
    assert.equal(list.success, true, q);
    const csv = await get(token, `/api/admin/tickets/export.csv?${q}`);
    assert.equal(csv.status, 200, q);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(csv.headers.get('content-disposition'), /attachment; filename="tickets-\d{8}\.csv"/);
    assert.equal(csv.headers.get('cache-control'), 'no-store');
    const rows = parseCsv(await csv.text());
    const ids = rows.slice(1).map((r) => Number(r[0])).sort((a, b) => a - b);
    const listIds = list.tickets.map((x) => x.id).sort((a, b) => a - b);
    assert.deepEqual(ids, listIds, `ids for "${q}"`);
    assert.equal(list.total, ids.length, `count for "${q}"`);
    assert.ok(ids.filter((i) => mine.has(i)).length >= 0);
  }
});

test('the filters pick the right tickets', async () => {
  const { token, t } = await seed();
  const idsOf = async (q) => (await (await get(token, `/api/admin/tickets?limit=200&${q}`)).json()).tickets.map((x) => x.id);
  assert.ok((await idsOf('campus=SOUTH')).includes(t.south) && !(await idsOf('campus=SOUTH')).includes(t.north));
  assert.ok((await idsOf('priority=URGENT')).includes(t.south));
  assert.ok((await idsOf('awaiting_confirmation=1')).includes(t.inject));
  assert.ok((await idsOf('sent_back=1')).includes(t.back));
  assert.ok(!(await idsOf('')).includes(t.mock) && !(await idsOf('')).includes(t.gone));
  assert.ok((await idsOf('include_mock=1')).includes(t.mock));
  assert.ok((await idsOf('include_deleted=1')).includes(t.gone));
  // IST boundary: created 20:00 UTC on 10 Jan is 01:30 IST on 11 Jan.
  assert.ok((await idsOf('from=2026-01-11&to=2026-01-11')).includes(t.old));
  assert.ok(!(await idsOf('from=2026-01-10&to=2026-01-10')).includes(t.old));
});

test('csv content: columns, IST times, award amount, injection neutralised, quoted names', async () => {
  const { token, t } = await seed();
  const rows = parseCsv(await (await get(token, '/api/admin/tickets/export.csv?include_mock=1&include_deleted=1')).text());
  const header = rows[0];
  assert.equal(header[0].replace('﻿', ''), 'ID');
  for (const col of ['Stage label', 'Award amount', 'Resolution kind', 'Sent back count', 'Test ticket', 'Deleted']) assert.ok(header.includes(col), col);
  const by = Object.fromEntries(rows.slice(1).map((r) => [Number(r[0]), Object.fromEntries(header.map((h, i) => [h.replace('﻿', ''), r[i]]))]));
  assert.equal(by[t.north]['Award amount'], '125000.5');
  assert.equal(by[t.north]['Stage label'], 'With JE');
  assert.equal(by[t.north]['Raised by (name)'], 'Asha, "A" Rao');
  assert.ok(by[t.inject].Title.startsWith("'="), `injection guard: ${by[t.inject].Title}`);
  assert.equal(by[t.old].Created, '2026-01-11 01:30', 'IST');
  assert.equal(by[t.mock]['Test ticket'], 'Yes');
  assert.equal(by[t.gone].Deleted, 'Yes');
  assert.equal(by[t.back]['Sent back count'], '1');
});

test('bad input is 400 naming the field; a non-Sysadmin gets 403', async () => {
  const { token, applicantToken } = await seed();
  for (const url of ['/api/admin/tickets?status=BANANA', '/api/admin/tickets/export.csv?from=nope', '/api/admin/tickets?campus=WEST']) {
    const r = await get(token, url);
    assert.equal(r.status, 400, url);
    const b = await r.json();
    assert.equal(b.code, 'VALIDATION_ERROR');
    assert.ok(b.errors.length >= 1 && b.errors[0].path);
  }
  assert.equal((await get(applicantToken, '/api/admin/tickets')).status, 403);
  assert.equal((await get(applicantToken, '/api/admin/tickets/export.csv')).status, 403);
});
