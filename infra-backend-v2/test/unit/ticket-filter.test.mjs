// The Sysadmin filter: every parameter, the IST day boundary, bad input, and the CSV escaping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTicketFilter, FilterError } from '../../src/services/ticketFilter.js';
import { csvCell, csvRow, BOM, CRLF } from '../../src/utils/csv.js';

const f = (q) => buildTicketFilter(q);
const bad = (q) => { try { f(q); } catch (e) { assert.ok(e instanceof FilterError); return e.issues.map((i) => i.path); } return null; };

test('defaults hide test and deleted tickets; nothing else is filtered', () => {
  const { whereSql, params } = f({});
  assert.equal(whereSql, '1 = 1 AND t.is_mock = FALSE AND t.deleted_at IS NULL');
  assert.deepEqual(params, []);
  assert.equal(f({ include_mock: '1', include_deleted: '1' }).whereSql, '1 = 1');
  assert.equal(f({ status: 'ALL', campus: 'ALL', department: '', priority: 'ALL', type: 'ALL' }).params.length, 0);
});

test('each parameter adds one bound condition', () => {
  const { whereSql, params } = f({ status: 'CLOSED,WORK_COMPLETED', campus: 'SOUTH', department: 'Civil', priority: 'URGENT', type: 'recurring' });
  for (const frag of ['t.status IN (?)', 't.campus = ?', 't.department = ?', 't.priority = ?', 't.type = ?']) assert.ok(whereSql.includes(frag), frag);
  assert.deepEqual(params, [['CLOSED', 'WORK_COMPLETED'], 'SOUTH', 'Civil', 'URGENT', 'recurring']);
});

test('dates are IST calendar days converted to UTC bounds', () => {
  const { params } = f({ from: '2026-10-01', to: '2026-10-01' });
  assert.equal(params[0].toISOString(), '2026-09-30T18:30:00.000Z', '00:00 IST');
  assert.equal(params[1].toISOString(), '2026-10-01T18:30:00.000Z', 'exclusive end = the next IST midnight');
  // 23:59 IST on the 1st (18:29 UTC) is inside; 00:00 IST on the 2nd (18:30 UTC) is outside.
  assert.ok(new Date('2026-10-01T18:29:00Z') < params[1] && !(new Date('2026-10-01T18:30:00Z') < params[1]));
});

test('presets', () => {
  assert.ok(f({ awaiting_confirmation: '1' }).whereSql.includes('t.status = ?'));
  assert.deepEqual(f({ awaiting_confirmation: 'true' }).params, ['WORK_COMPLETED']);
  assert.ok(f({ sent_back: '1' }).whereSql.includes('t.applicant_sent_back_at IS NOT NULL'));
});

test('search escapes LIKE wildcards and understands a ticket number', () => {
  const s = f({ search: '50%_off' });
  assert.deepEqual(s.params.slice(0, 4), Array(4).fill('%50\\%\\_off%'));
  assert.ok(!s.whereSql.includes('t.id = ?'));
  const byNo = f({ search: '#TKT-0042' });
  assert.equal(byNo.params.at(-1), 42);
  assert.equal(f({ search: '42' }).params.at(-1), 42);
});

test('bad input is refused naming the field', () => {
  assert.deepEqual(bad({ status: 'CLOSED,BANANA' }), ['status.1']);
  assert.deepEqual(bad({ campus: 'WEST' }), ['campus']);
  assert.deepEqual(bad({ department: 'Plumbing' }), ['department']);
  assert.deepEqual(bad({ priority: 'HIGH' }), ['priority']);
  assert.deepEqual(bad({ type: 'x' }), ['type']);
  assert.deepEqual(bad({ from: '2026-02-30' }), ['from']);
  assert.deepEqual(bad({ to: 'yesterday' }), ['to']);
  assert.deepEqual(bad({ from: '2026-10-02', to: '2026-10-01' }), ['to']);
  assert.deepEqual(bad({ include_mock: 'maybe' }), ['include_mock']);
  assert.deepEqual(bad({ search: 'x'.repeat(101) }), ['search']);
});

test('csv: quoting, CRLF, BOM, numbers and booleans', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(-5), '-5', 'a real number is not a formula');
  assert.equal(csvCell(true), 'Yes');
  assert.equal(csvCell('अनुमान'), 'अनुमान');
  assert.equal(csvRow(['a', 1, 'b,c']), `a,1,"b,c"${CRLF}`);
  assert.equal(BOM, '﻿');
});

test('csv: formula injection is neutralised', () => {
  for (const cell of ['=HYPERLINK("http://x","y")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd']) {
    assert.ok(csvCell(cell).replace(/^"/, '').startsWith("'"), JSON.stringify(cell));
  }
  assert.equal(csvCell('safe=text'), 'safe=text');
});
