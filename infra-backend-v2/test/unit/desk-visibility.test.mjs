// plan2.md Phase 2: pinned AE holder visibility, applicant blindness for the new
// columns, self-action flag pass-through, placeholder addresses.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildViewer, buildTicketDetails, applicantTicket, filterAudit, staffRole,
} from '../../src/services/visibility.js';
import { availableActions } from '../../src/config/workflow.js';
import { isPlaceholderEmail } from '../../src/utils/mailer.js';

const ticket = {
  id: 7, applicant_id: 1, assigned_je_id: 2, assigned_ae_id: 3, assigned_se_id: 4, is_mock: 0,
  current_desk_user_id: 4, department: 'Civil', campus: 'NORTH', status: 'PENDING_SE_APPROVAL',
  title: 'Leak', description: 'd', type: 'recurring', priority: 'NORMAL',
  applicant_name: 'Asha', applicant_email: 'a@x.in', assignees: { AE: { id: 3, name: 'Ae Person' } },
};
const emptyData = { attachments: [], reports: [], tenders: [], bills: [], auditLogs: [], messages: [] };

test('applicantTicket never carries pinned holders, desk holder, mock flag or assignees', () => {
  const out = applicantTicket(ticket);
  for (const k of ['assigned_je_id', 'assigned_ae_id', 'assigned_se_id', 'current_desk_user_id', 'is_mock', 'assignees']) {
    assert.equal(k in out, false, k);
  }
  assert.equal(JSON.stringify(out).includes('Ae Person'), false);
});

test('applicant-only viewer gets no person data in the details payload', () => {
  const viewer = buildViewer({ id: 1, role: 'APPLICANT' }, ticket);
  const out = buildTicketDetails(viewer, ticket, emptyData);
  assert.equal(staffRole(viewer, ticket), null);
  for (const k of ['assigned_ae_id', 'assigned_se_id', 'current_desk_user_id', 'assignees', 'is_mock']) {
    assert.equal(k in out, false, k);
  }
  assert.deepEqual(out.audit_logs, []);
});

test('pinned AE keeps sight of a ticket after it moved on, even outside scope', () => {
  const ae = { id: 3, role: 'AE', department: 'Electrical' };
  const viewer = buildViewer(ae, ticket, { scopes: [{ department: 'Electrical', campus: 'SOUTH' }] });
  assert.equal(viewer.aeInScope, true);
  assert.equal(staffRole(viewer, ticket), 'AE');
});

test('an AE who is neither pinned, holding nor in scope has no view', () => {
  const other = { id: 99, role: 'AE', department: 'Electrical' };
  const viewer = buildViewer(other, ticket, { scopes: [{ department: 'Electrical', campus: 'SOUTH' }] });
  assert.equal(staffRole(viewer, ticket), null);
});

test('filterAudit passes is_self_action through to staff, as a boolean', () => {
  const viewer = buildViewer({ id: 4, role: 'SE' }, ticket);
  const rows = [
    { action: 'FORWARDED', remarks: 'r', created_at: 1, actor_name: 'n', actor_role: 'SE', user_id: 4, is_self_action: 1 },
    { action: 'APPROVED', remarks: 'r', created_at: 2, actor_name: 'n', actor_role: 'SE', user_id: 4 },
  ];
  const out = filterAudit(viewer, ticket, rows);
  assert.deepEqual(out.map((r) => r.is_self_action), [true, false]);
});

test('a desk holder who also raised the ticket still gets the normal actions', () => {
  const ae = { id: 5, role: 'AE' };
  const t = { status: 'PENDING_AE_APPROVAL', current_desk_user_id: 5 };
  const { actions } = availableActions(ae, t, {});
  assert.deepEqual(actions.map((a) => a.action), ['FORWARD', 'REQUEST_CHANGES']);
  assert.equal(actions[0].enabled, true);
});

test('isPlaceholderEmail matches only the reserved .invalid TLD', () => {
  assert.equal(isPlaceholderEmail('dean@placeholder.invalid'), true);
  assert.equal(isPlaceholderEmail(' Dean@PLACEHOLDER.INVALID '), true);
  assert.equal(isPlaceholderEmail('dean@campus.edu'), false);
  assert.equal(isPlaceholderEmail('invalid@campus.edu'), false);
  assert.equal(isPlaceholderEmail(null), false);
});
