// A migration that can destroy data is refused unless it carries a reviewed marker.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { lintMigration } from '../../src/config/migrationLint.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

test('every committed migration passes the lint', () => {
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.sql'))) {
    const r = lintMigration(fs.readFileSync(path.join(DIR, f), 'utf8'));
    assert.ok(r.ok, `${f}: ${r.found.join(', ')}`);
  }
});

for (const sql of [
  'DROP TABLE infra_users;',
  'drop database infraseva;',
  'DROP SCHEMA x;',
  'TRUNCATE infra_tickets;',
  'USE other_db;',
  'CREATE DATABASE other;',
  'DELETE FROM infra_users;',
]) {
  test(`refuses: ${sql}`, () => {
    const r = lintMigration(sql);
    assert.equal(r.ok, false);
    assert.ok(r.found.length > 0);
  });
}

test('the destructive-ok marker lets a reviewed file through', () => {
  const r = lintMigration('-- destructive-ok: pre-launch, table empty\nALTER TABLE infra_tenders DROP COLUMN bid_opening_date;\nDROP TABLE infra_x;');
  assert.equal(r.ok, true);
  assert.equal(r.marked, true);
});

test('words inside comments and strings are ignored; DELETE with WHERE is fine', () => {
  const r = lintMigration("-- we never DROP TABLE here\nINSERT INTO infra_notifications (body) VALUES ('use TRUNCATE later');\nDELETE FROM infra_users WHERE id = 1;");
  assert.equal(r.ok, true);
  assert.deepEqual(r.found, []);
});
