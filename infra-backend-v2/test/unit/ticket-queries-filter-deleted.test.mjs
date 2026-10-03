// A soft-deleted ticket stays in the table, so a query that forgets `deleted_at` would resurface it. This test
// scans src/ for every SQL string that reads infra_tickets and fails for any that neither mentions deleted_at
// nor is on the short, reviewed allow-list below (single-row lookups that sit behind the 404 param loader,
// the Sysadmin routes, and internal loaders). A new query cannot forget the filter silently.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src');

// file (relative to src) + a snippet that identifies the statement + why it may read deleted tickets.
const ALLOWED = [
  ['middleware/testRole.js', 'SELECT is_mock FROM infra_tickets', 'runs before the deleted-ticket loader; reads one flag'],
  ['middleware/testRole.js', 'JOIN infra_tickets t ON t.id = a.ticket_id', 'runs before the deleted-attachment loader; reads one flag'],
  ['models/ticketModel.js', 'FROM infra_tickets WHERE id = ? FOR UPDATE', 'single-row lock behind the param loader'],
  ['models/ticketModel.js', 'FROM infra_tickets WHERE id = ? AND assigned_je_id = ? FOR UPDATE', 'single-row lock behind the param loader'],
  ['controllers/lifecycleController.js', 'FROM infra_tickets WHERE id = ? AND assigned_je_id = ? FOR UPDATE', 'single-row lock behind the param loader'],
  ['controllers/ticketController.js', "FROM infra_tickets WHERE id = ?'", 'single-row reads behind the param loader'],
  ['controllers/ticketController.js', 'FROM infra_tickets WHERE id = ? FOR UPDATE', 'single-row lock behind the param loader'],
  ['controllers/deskController.js', 'FROM infra_tickets WHERE id = ?', 'single-row read behind the param loader (JE picker)'],
  ['routes/ticketRoutes.js', 'FROM infra_tickets WHERE id = ?', 'single-row read behind the param loader'],
  ['routes/ticketRoutes.js', 'WHERE t.id = ?', 'ticket details: single row behind the param loader'],
  ['services/notifier.js', 'WHERE t.id = ?', 'internal loader for a ticket the caller already holds'],
  // Sysadmin routes: they are the only way to reach a deleted ticket.
  ['controllers/adminController.js', 'WHERE t.id = ?', 'Sysadmin ticket details'],
  ['controllers/adminController.js', 'FROM infra_tickets WHERE id = ? FOR UPDATE', 'Sysadmin override, delete and restore lock one ticket'],
  ['controllers/adminController.js', 'WHERE is_mock = TRUE', 'Sysadmin test-ticket list'],
  ['controllers/adminController.js', 'JOIN infra_tickets t ON a.ticket_id = t.id', 'Sysadmin master audit log'],
  ['controllers/adminController.js', 'DELETE FROM infra_tickets WHERE id = ? AND is_mock = TRUE', 'test-ticket hard delete (never a real ticket)'],
  ['controllers/adminController.js', 'JOIN infra_users u_app ON t.applicant_id = u_app.id', 'TICKET_JOINS: list and export build their WHERE from services/ticketFilter.js (deleted filter checked below)'],
  ['controllers/deskController.js', 'COALESCE(t.status_changed_at', 'ROW_SELECT: every caller appends the filter (checked below)'],
  ['controllers/ticketController.js', 'tn.award_amount', 'getQueue base select: its WHERE list starts with the deleted filter (checked below)'],
];

// A small tokenizer: the regex approach breaks on a template literal nested in a `${...}`.
function readQuoted(text, i, quote) {
  let k = i + 1;
  while (k < text.length && text[k] !== quote) k += text[k] === '\\' ? 2 : 1;
  return k + 1;
}
function readTemplate(text, i) {
  let k = i + 1;
  while (k < text.length) {
    if (text[k] === '\\') { k += 2; continue; }
    if (text[k] === '`') return k + 1;
    if (text[k] === '$' && text[k + 1] === '{') {
      let depth = 1;
      k += 2;
      while (k < text.length && depth > 0) {
        const c = text[k];
        if (c === '`') k = readTemplate(text, k);
        else if (c === "'" || c === '"') k = readQuoted(text, k, c);
        else { if (c === '{') depth += 1; if (c === '}') depth -= 1; k += 1; }
      }
      continue;
    }
    k += 1;
  }
  return k;
}

function sqlStrings(file) {
  // Whole-line comments out first: a backtick or quote inside one would desynchronise the scan.
  const text = fs.readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    let end = null;
    if (c === '`') end = readTemplate(text, i);
    else if (c === "'" || c === '"') end = readQuoted(text, i, c);
    if (end === null) { i += 1; continue; }
    const str = text.slice(i, end);
    if (/\b(FROM|JOIN)\s+infra_tickets\b/i.test(str) || str.includes('${ROW_SELECT}')) out.push(str);
    i = end;
  }
  return out;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}

test('every SQL that reads infra_tickets filters deleted_at or is on the reviewed allow-list', () => {
  const offenders = [];
  const used = new Set();
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    for (const sql of sqlStrings(file)) {
      if (sql.includes('deleted_at') || sql.includes('${LIVE}')) continue; // LIVE = the digest's shared filter (checked below)
      const hit = ALLOWED.findIndex(([f, snippet]) => f === rel && sql.includes(snippet));
      if (hit >= 0) { used.add(hit); continue; }
      offenders.push(`${rel}: ${sql.replace(/\s+/g, ' ').slice(0, 140)}`);
    }
  }
  assert.deepEqual(offenders, [], 'these queries read infra_tickets without deleted_at');
  const stale = ALLOWED.filter((_, i) => !used.has(i)).map(([f, s]) => `${f}: ${s}`);
  assert.deepEqual(stale, [], 'allow-list entries that no longer match anything: remove them');
});

test('the ROW_SELECT callers in deskController all filter deleted tickets', () => {
  for (const sql of sqlStrings(path.join(SRC, 'controllers/deskController.js'))) {
    if (sql.includes('${ROW_SELECT}')) assert.ok(sql.includes('deleted_at IS NULL'), sql.replace(/\s+/g, ' ').slice(0, 120));
  }
});

test('the shared filters themselves exclude deleted tickets', () => {
  const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
  assert.match(read('services/digest.js'), /const LIVE = '[^']*t\.deleted_at IS NULL[^']*'/);
  assert.match(read('services/ticketFilter.js'), /if \(!q\.include_deleted\) where\.push\('t\.deleted_at IS NULL'\)/);
  assert.match(read('controllers/ticketController.js'), /let whereClauses = \['t\.is_mock = FALSE', 't\.deleted_at IS NULL'\]/);
});
