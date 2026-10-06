// `schema-fingerprint.mjs --check` compares the core_ and mnt_ objects of the connected database with
// migrations/expected-schema.txt. A migration that forgets to update that file fails here, in CI.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pool } from './helpers.mjs';

after(async () => { await pool.end(); });

const check = () => spawnSync(process.execPath, ['scripts/schema-fingerprint.mjs', '--check'], { encoding: 'utf8' });

test('the migrated database matches migrations/expected-schema.txt', () => {
  const r = check();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /schema OK/);
});

test('a difference in a module table is reported and fails the check', async () => {
  await pool.query('ALTER TABLE mnt_bills ADD COLUMN ci_extra INT NULL');
  try {
    const r = check();
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /\+ COLUMN mnt_bills .* ci_extra/);
  } finally {
    await pool.query('ALTER TABLE mnt_bills DROP COLUMN ci_extra');
  }
});

test('an object of another module is ignored by the check', async () => {
  await pool.query('CREATE TABLE ci_other_module_probe (x INT PRIMARY KEY)');
  try {
    assert.equal(check().status, 0);
  } finally {
    await pool.query('DROP TABLE ci_other_module_probe');
  }
});
