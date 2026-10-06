// X2: the frontend status list must equal the backend STATUS vocabulary, and
// the group arrays must match, so a status added on one side is caught here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as wf from '../../src/config/workflow.js';
import { STAFF_STATUS } from '../../src/emails/labels.js';

const src = fs.readFileSync(new URL('../../../infra-frontend/src/lib/statuses.ts', import.meta.url), 'utf8');
const list = (name) => {
  const m = src.match(new RegExp(`${name}[^=]*=\\s*\\[([^\\]]*)\\]`, 's'));
  assert.ok(m, `${name} not found in statuses.ts`);
  return [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
};

test('frontend ALL_STATUSES equals backend STATUS', () => {
  assert.deepEqual([...list('ALL_STATUSES')].sort(), Object.values(wf.STATUS).sort());
});

test('frontend status groups equal backend groups', () => {
  for (const g of ['JE_STAGE', 'APPROVAL_STAGE', 'TENDER_STAGE', 'IN_WORK', 'TERMINAL']) {
    assert.deepEqual(list(`export const ${g}`).sort(), [...wf[g]].sort(), g);
  }
  assert.deepEqual([...wf.POST_APPROVAL].sort(), [...wf.TENDER_STAGE, ...wf.IN_WORK, 'CLOSED'].sort());
});

test('mail stage labels equal the frontend staff status labels', () => {
  const block = src.match(/const STAFF_STATUS[^=]*=\s*\{([^}]*)\}/s);
  assert.ok(block, 'STAFF_STATUS not found in statuses.ts');
  const labels = Object.fromEntries([...block[1].matchAll(/([A-Z_]+):\s*'([^']*)'/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual({ ...STAFF_STATUS }, labels);
});
