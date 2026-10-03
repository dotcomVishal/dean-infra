// Every table of this module is prefixed `infra_`. A bare name in SQL would hit (or create)
// somebody else's table in a shared database.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TABLES = [
  'users', 'user_scopes', 'user_availability', 'tickets', 'audit_logs', 'ticket_messages', 'reports',
  'attachments', 'tenders', 'financial_limits', 'notifications', 'schema_migrations', 'bills',
];
const BARE = new RegExp(`\\b(FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES)\\s+\`?(${TABLES.join('|')})\\b`, 'gi');

function files(dir, exts) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'uploads' ? [] : files(p, exts);
    return exts.some((x) => e.name.endsWith(x)) && e.name !== 'no-bare-table-names.test.mjs' ? [p] : [];
  });
}

test('no unprefixed module table name in SQL (src, scripts, test, migrations)', () => {
  const hits = [];
  for (const dir of ['src', 'scripts', 'test', 'migrations']) {
    for (const f of files(path.join(ROOT, dir), ['.js', '.mjs', '.sql'])) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|--)/.test(line)) return;
        for (const m of line.matchAll(BARE)) hits.push(`${path.relative(ROOT, f)}:${i + 1}: ${m[0]}`);
      });
    }
  }
  assert.deepEqual(hits, []);
});
