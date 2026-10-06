// Phase 6: the filter builder (every parameter and combination) and the CSV writer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdminTicketFilter, istDayStartUtc, nextDay } from '../../src/services/adminTicketFilter.js';
import { csvCell, csvRow, CSV_BOM } from '../../src/utils/csv.js';

const ok = (q) => { const r = buildAdminTicketFilter(q); assert.equal(r.ok, true, JSON.stringify(r)); return r; };
const bad = (q, path) => {
  const r = buildAdminTicketFilter(q);
  assert.equal(r.ok, false);
  if (path) assert.ok(r.errors.some((e) => e.path === path), JSON.stringify(r.errors));
  return r;
};

test('no filters: real tickets only', () => {
  const r = ok({});
  assert.equal(r.whereSql, 'WHERE 1=1 AND t.is_mock = FALSE');
  assert.deepEqual(r.params, []);
});

test('"ALL" and blanks mean no filter', () => {
  const r = ok({ status: 'ALL', department: 'ALL', type: 'ALL', campus: '', priority: undefined, search: '  ' });
  assert.deepEqual(r.params, []);
});

test('include_mock lifts the mock exclusion', () => {
  assert.ok(!ok({ include_mock: '1' }).whereSql.includes('is_mock'));
  assert.ok(ok({ include_mock: '0' }).whereSql.includes('is_mock'));
});

test('status: one, a comma list, or a repeated parameter', () => {
  assert.deepEqual(ok({ status: 'CLOSED' }).params, [['CLOSED']]);
  assert.deepEqual(ok({ status: 'CLOSED,DENIED' }).params, [['CLOSED', 'DENIED']]);
  assert.deepEqual(ok({ status: ['CLOSED', 'UNASSIGNED'] }).params, [['CLOSED', 'UNASSIGNED']]);
  assert.match(ok({ status: 'CLOSED' }).whereSql, /t\.status IN \(\?\)/);
  bad({ status: 'BANANA' }, 'status.0');
  bad({ status: 'CLOSED,NOPE' });
});

test('every single-value filter is validated against the real values', () => {
  for (const [key, good, wrong] of [
    ['department', 'Civil', 'Plumbing'], ['campus', 'SOUTH', 'EAST'], ['priority', 'URGENT', 'HIGH'], ['type', 'recurring', 'daily'],
  ]) {
    const r = ok({ [key]: good });
    assert.deepEqual(r.params, [good]);
    assert.match(r.whereSql, new RegExp(`t\\.${key} = \\?`));
    bad({ [key]: wrong }, key);
  }
});

test('dates are whole days in IST, as a half-open range converted by MySQL', () => {
  // 2026-10-05 00:00 IST = 2026-10-04 18:30 UTC
  assert.equal(istDayStartUtc('2026-10-05').toISOString(), '2026-10-04T18:30:00.000Z');
  assert.equal(nextDay('2026-10-31'), '2026-11-01');
  assert.equal(nextDay('2026-12-31'), '2027-01-01');
  const r = ok({ created_from: '2026-10-05', created_to: '2026-10-07' });
  assert.match(r.whereSql, /t\.created_at >= CONVERT_TZ\(\?, '\+05:30', @@session\.time_zone\)/);
  assert.match(r.whereSql, /t\.created_at < CONVERT_TZ\(\?, '\+05:30', @@session\.time_zone\)/);
  assert.deepEqual(r.params, ['2026-10-05 00:00:00', '2026-10-08 00:00:00']); // 8 Oct 00:00 IST: the to-day is included
  bad({ created_from: '05/10/2026' }, 'created_from');
  bad({ created_to: '2026-02-30' }, 'created_to');
  bad({ created_from: '2026-10-08', created_to: '2026-10-05' }, 'created_to');
  assert.equal(ok({ created_from: '2026-10-05', created_to: '2026-10-05' }).params.length, 2); // same day is fine
});

test('search: text and ticket id, parameters in clause order', () => {
  const r = ok({ search: '42' });
  assert.deepEqual(r.params, ['%42%', '%42%', 42, '%42%', '%42%', '%42%']);
  const t = ok({ search: 'leak' });
  assert.equal(t.params[2], 0);
  assert.match(t.whereSql, /t\.landmark LIKE \?/);
});

test('all filters together: clauses and params stay aligned', () => {
  const r = ok({ status: 'CLOSED', department: 'Civil', campus: 'NORTH', priority: 'NORMAL', type: 'recurring',
    created_from: '2026-10-01', created_to: '2026-10-31', search: 'x' });
  assert.equal((r.whereSql.match(/\?/g) ?? []).length, r.params.length);
});

test('csv: quoting for commas, quotes, newlines', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line1\nline2'), '"line1\nline2"');
  assert.equal(csvCell('cr\rlf'), '"cr\rlf"'); // a carriage return inside the text is only quoted
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(12345.5), '12345.5');
  assert.equal(csvRow(['a', 'b,c', 3]), 'a,"b,c",3\r\n');
  assert.equal(CSV_BOM, '﻿');
});

test('csv: formula injection is neutralised for every leading character', () => {
  for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
    const cell = csvCell(`${lead}SUM(A1)`);
    assert.ok(cell.includes(`'${lead}SUM(A1)`), JSON.stringify(cell));
    assert.ok(!/^[=+\-@]/.test(cell.replace(/^"/, '')), 'a formula character never leads the cell');
  }
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell("=HYPERLINK(\"http://x\",\"y\")"), '"\'=HYPERLINK(""http://x"",""y"")"');
  assert.equal(csvCell('safe - dash'), 'safe - dash');
  assert.equal(csvCell(-5), '-5'); // a number is not text: not guarded
});
