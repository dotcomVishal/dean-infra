// Who gets which mail: the whole role x event matrix of services/emailPolicy.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT, POLICY, allows, remindersAllowed, DIGEST_ROLES } from '../../src/services/emailPolicy.js';

const ROLES = ['JE', 'AE', 'SE', 'DEAN', 'CLERICAL', 'ACCOUNTANT', 'DIRECTOR', 'SYSADMIN', 'APPLICANT'];

const EXPECT = {
  JE: [EVENT.JE_ASSIGNED, EVENT.JE_REASSIGNED_TO, EVENT.JE_REASSIGNED_AWAY, EVENT.CHANGES_REQUESTED,
    EVENT.APPROVED, EVENT.REJECTED_JE, EVENT.APPLICANT_SENT_BACK],
  AE: [EVENT.ARRIVAL], SE: [EVENT.ARRIVAL], DEAN: [EVENT.ARRIVAL],
  CLERICAL: [], ACCOUNTANT: [], DIRECTOR: [], SYSADMIN: [],
  APPLICANT: [EVENT.RECEIVED, EVENT.RESOLVED, EVENT.REJECTED, EVENT.CLOSED],
};

test('role x event matrix equals the policy table', () => {
  for (const role of ROLES) {
    for (const event of Object.values(EVENT)) {
      assert.equal(allows(role, event), EXPECT[role].includes(event), `${role} / ${event}`);
    }
  }
});

test('only the JE is reminded', () => {
  for (const role of ROLES) assert.equal(remindersAllowed(role), role === 'JE', role);
});

test('digest goes to AE, SE, Dean, Clerical and Accountant only', () => {
  assert.deepEqual([...DIGEST_ROLES].sort(), ['ACCOUNTANT', 'AE', 'CLERICAL', 'DEAN', 'SE']);
  for (const role of ['JE', 'DIRECTOR', 'SYSADMIN', 'APPLICANT']) assert.equal(POLICY[role].digest, false, role);
});

test('Director and Sysadmin get no automated mail of any kind', () => {
  for (const role of ['DIRECTOR', 'SYSADMIN']) {
    assert.equal(POLICY[role].events.size, 0);
    assert.equal(POLICY[role].reminders, false);
    assert.equal(POLICY[role].digest, false);
  }
});

test('an unknown recipient kind gets nothing', () => {
  assert.equal(allows('STRANGER', EVENT.ARRIVAL), false);
  assert.equal(remindersAllowed('STRANGER'), false);
});
