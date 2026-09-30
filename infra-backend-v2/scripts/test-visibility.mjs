// Phase 5/6 unit tests, no DB / network:  node --test scripts/test-visibility.mjs
// Visibility matrix (plan.md §3.6) row by row, reminder schedule, sanitized applicant mail,
// upload allow-list.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildViewer, canViewTicket, capabilities, canViewAttachment, filterMessages, filterAudit,
  buildTicketDetails, redactQueueRow, stageLabel, uploadCategory,
} from '../src/services/visibility.js';
import { reminderDueAt, copiesAe } from '../src/services/notifier.js';
import { applicantStageEmail } from '../src/services/emailTemplates.js';
import { fileFilter } from '../src/middleware/upload.js';

const ticket = (o = {}) => ({
  id: 1, applicant_id: 100, assigned_je_id: 10, current_desk_user_id: 10,
  department: 'Civil', campus: 'NORTH', status: 'ASSIGNED_TO_JE', ...o,
});
const V = (user, t = ticket(), facts = {}) => buildViewer(user, t, facts);
const applicant = { id: 100, role: 'APPLICANT' };
const je = { id: 10, role: 'JE' };
const otherJe = { id: 11, role: 'JE' };
const ae = { id: 20, role: 'AE', department: 'Civil' };
const se = { id: 30, role: 'SE' }, dean = { id: 40, role: 'DEAN' }, dir = { id: 50, role: 'DIRECTOR' };
const clerk = { id: 60, role: 'CLERICAL' }, acct = { id: 70, role: 'ACCOUNTANT' }, admin = { id: 80, role: 'SYSADMIN' };
const scopesNorthCivil = [{ department: 'Civil', campus: 'NORTH' }];

test('canViewTicket: who may open which ticket', () => {
  const t = ticket();
  const approved = ticket({ status: 'APPROVED_FOR_TENDERING' });
  const rows = [
    [applicant, t, {}, true], [{ id: 999, role: 'APPLICANT' }, t, {}, false],
    [je, t, {}, true], [otherJe, t, {}, false],
    [otherJe, t, { filedReport: true }, true],           // past JE
    [ae, t, { scopes: scopesNorthCivil }, true],
    [ae, ticket({ campus: 'SOUTH' }), { scopes: scopesNorthCivil }, false],
    [ae, ticket({ department: 'Electrical' }), { scopes: scopesNorthCivil }, false],
    [ae, ticket({ campus: 'SOUTH', current_desk_user_id: 20 }), { scopes: scopesNorthCivil }, true],
    [se, t, {}, true], [dean, t, {}, true], [dir, t, {}, true], [admin, t, {}, true],
    [clerk, t, {}, false], [clerk, approved, {}, true],
    [acct, t, {}, false], [acct, approved, {}, true],
  ];
  for (const [u, tk, facts, want] of rows) {
    assert.equal(canViewTicket(V(u, tk, facts), tk), want, `${u.role}#${u.id} on ${tk.status}/${tk.campus}`);
  }
});

test('staff who raised the ticket get the union of applicant and staff views', () => {
  const t = ticket({ applicant_id: 11 });                 // otherJe raised it, is not assigned
  const v = V(otherJe, t);
  assert.equal(canViewTicket(v, t), true);
  const caps = capabilities(v, t);
  assert.equal(caps.applicantView, true);
  assert.equal(caps.staff, null);                         // ...but gets NO staff view
  const t2 = ticket({ applicant_id: 10 });                // the assigned JE raised it too
  assert.equal(capabilities(V(je, t2), t2).staff, 'JE');
});

const att = (document_category, extra = {}) => ({ document_category, uploaded_by: 10, uploader_role: 'JE', ...extra });
test('canViewAttachment: category x viewer matrix', () => {
  const t = ticket({ status: 'WORK_IN_PROGRESS' });
  const cats = ['APPLICANT_EVIDENCE', 'JE_SITE_PHOTO', 'JE_ESTIMATE_DOC', 'CLERK_TENDER_DOC', 'FINANCE_SANCTION', 'AUTHORITY_REMARKS', 'DESK_DOC', 'WORK_DOC'];
  //                          applicant je     ae    se    dean  dir   clerk  acct   admin
  const want = {
    APPLICANT_EVIDENCE: [true,  true, true, true, true, true, true, true, true],
    JE_SITE_PHOTO:      [false, true, true, true, true, true, true, true, true],
    JE_ESTIMATE_DOC:    [false, true, true, true, true, true, true, true, true],
    CLERK_TENDER_DOC:   [false, true, true, true, true, true, true, true, true],
    FINANCE_SANCTION:   [false, false, true, true, true, true, true, true, true],
    AUTHORITY_REMARKS:  [false, false, false, false, true, true, false, false, true], // uploaded by DEAN below
    DESK_DOC:           [false, true, true, true, true, true, true, true, true],   // flows back to the JE
    WORK_DOC:           [true,  true, true, true, true, true, true, true, true],   // applicant verifies against it
  };
  const viewers = [applicant, je, ae, se, dean, dir, clerk, acct, admin];
  for (const cat of cats) {
    viewers.forEach((u, i) => {
      const a = att(cat, cat === 'AUTHORITY_REMARKS' ? { uploaded_by: 40, uploader_role: 'DEAN' } : { uploaded_by: 999 });
      const v = V(u, t, u.role === 'AE' ? { scopes: scopesNorthCivil } : {});
      assert.equal(canViewAttachment(v, t, a), want[cat][i], `${cat} as ${u.role}`);
    });
  }
});

test('applicant cannot download JE site photos; unrelated JE cannot download anything', () => {
  const t = ticket();
  assert.equal(canViewAttachment(V(applicant, t), t, att('JE_SITE_PHOTO', { uploaded_by: 10 })), false);
  assert.equal(canViewAttachment(V(otherJe, t), t, att('APPLICANT_EVIDENCE', { uploaded_by: 100 })), false);
  assert.equal(canViewAttachment(V(applicant, t), t, att('APPLICANT_EVIDENCE', { uploaded_by: 100 })), true);
});

test('uploadCategory: decided by who uploads, refused on closed tickets and to outsiders', () => {
  const wip = ticket({ status: 'WORK_IN_PROGRESS' });
  const pre = ticket();
  const cat = (u, t, facts = {}) => uploadCategory(V(u, t, facts), t);
  assert.equal(cat(applicant, wip), 'APPLICANT_EVIDENCE');
  assert.equal(cat(je, pre), 'JE_ESTIMATE_DOC');
  assert.equal(cat(je, wip), 'WORK_DOC');
  assert.equal(cat(ae, wip, { scopes: scopesNorthCivil }), 'DESK_DOC');
  for (const u of [se, dean, dir, admin]) assert.equal(cat(u, wip), 'DESK_DOC');
  assert.equal(cat(clerk, wip), 'CLERK_TENDER_DOC');
  assert.equal(cat(acct, wip), 'FINANCE_SANCTION');
  assert.equal(cat(clerk, pre), null);                    // Clerical cannot see a pre-approval ticket
  assert.equal(cat(otherJe, wip), null);
  assert.equal(cat(applicant, ticket({ status: 'CLOSED' })), null);
  assert.equal(cat(dir, ticket({ status: 'DENIED' })), null);
});

const msg = (kind, vfr, o = {}) => ({ id: 1, kind, visible_from_rank: vfr, author_name: 'Dean Name', to_name: 'JE Name', body: 'x', ...o });
test('messages: rank filter + applicant sees only PUBLIC_NOTE without names', () => {
  const t = ticket();
  const thread = [
    msg('CHANGE_REQUEST', 1), msg('CHANGE_REQUEST', 3), msg('INTERNAL_REMARK', 4), msg('INTERNAL_REMARK', 5),
    msg('REJECTION_REASON', 1), msg('PUBLIC_NOTE', 0),
  ];
  const kinds = (u, facts) => filterMessages(V(u, t, facts), t, thread).map((m) => `${m.kind}:${m.visible_from_rank}`);
  assert.deepEqual(kinds(je), ['CHANGE_REQUEST:1', 'REJECTION_REASON:1', 'PUBLIC_NOTE:0']);
  assert.deepEqual(kinds(ae, { scopes: scopesNorthCivil }), ['CHANGE_REQUEST:1', 'REJECTION_REASON:1', 'PUBLIC_NOTE:0']);
  assert.equal(kinds(se).length, 4);                       // + CR:3
  assert.equal(kinds(dean).length, 5);                 // everything but the Director's remark
  assert.equal(kinds(dir).length, 6);
  assert.equal(kinds(admin).length, 6);
  assert.deepEqual(kinds(clerk, {}), []);                  // not viewable at ASSIGNED_TO_JE
  const pub = filterMessages(V(applicant, t), t, thread);
  assert.deepEqual(pub.map((m) => m.kind), ['PUBLIC_NOTE']);
  assert.equal(pub[0].author_name, null);
  assert.equal(pub[0].to_name, null);
  assert.equal(filterMessages(V(otherJe, t), t, thread).length, 0);   // unrelated JE: nothing
});

const A = (action, o = {}) => ({
  action, remarks: `secret ${action}`, created_at: 't', actor_name: 'Someone', actor_role: 'DEAN',
  user_id: 40, visibility: 'ALL', from_desk: null, to_desk: null, ...o,
});
test('audit log: applicant none, JE neutral text, no executive detail', () => {
  const t = ticket();
  const rows = [
    A('CREATED', { actor_role: 'APPLICANT', remarks: 'Ticket raised' }),
    A('FORWARDED'), A('APPROVED'),
    A('CHANGES_REQUESTED', { visibility: 'INTERNAL', from_desk: 'DIRECTOR', to_desk: 'SE' }),
    A('CHANGES_REQUESTED', { visibility: 'INTERNAL', from_desk: 'SE', to_desk: 'JE' }),
    A('REMINDER_SENT', { user_id: 10, actor_role: 'JE', remarks: 'Reminder 2 sent to JE' }),
    A('REMINDER_SENT', { user_id: 11, actor_role: 'JE', remarks: 'Reminder 2 sent to JE' }),
    A('SUBMITTED', { actor_role: 'JE', user_id: 10, remarks: 'Report v1' }),
  ];
  assert.deepEqual(filterAudit(V(applicant, t), t, rows), []);
  const jeRows = filterAudit(V(je, t), t, rows);
  assert.deepEqual(jeRows.map((r) => r.action), ['CREATED', 'FORWARDED', 'APPROVED', 'CHANGES_REQUESTED', 'REMINDER_SENT', 'SUBMITTED']);
  const fw = jeRows.find((r) => r.action === 'FORWARDED');
  assert.equal(fw.remarks, 'Forwarded for review');        // authority text replaced
  assert.ok(!('actor_name' in fw));
  assert.equal(jeRows.filter((r) => r.action === 'CHANGES_REQUESTED').length, 1);   // only the one addressed to JE
  assert.ok(!JSON.stringify(jeRows).includes('secret'));
  // AE sees SE->JE request but not Director->SE
  const aeRows = filterAudit(V(ae, t, { scopes: scopesNorthCivil }), t, rows);
  assert.equal(aeRows.filter((r) => r.action === 'CHANGES_REQUESTED').length, 1);
  assert.equal(aeRows.filter((r) => r.action === 'REMINDER_SENT').length, 2);
  assert.equal(filterAudit(V(dir, t), t, rows).length, rows.length);
  assert.equal(filterAudit(V(admin, t), t, rows).length, rows.length);
});

test('audit log: Clerical/Accountant see only the post-approval trail', () => {
  const t = ticket({ status: 'TENDER_PUBLISHED' });
  const rows = [A('FORWARDED'), A('APPROVED'), A('TENDER_PUBLISHED'), A('REMINDER_SENT'), A('BILL_RECORDED')];
  for (const u of [clerk, acct]) {
    assert.deepEqual(filterAudit(V(u, t), t, rows).map((r) => r.action), ['APPROVED', 'TENDER_PUBLISHED', 'BILL_RECORDED']);
  }
});

test('details payload: applicant view is an allow-list with no people, files or money', () => {
  const t = { ...ticket({ status: 'PENDING_SE_APPROVAL' }), title: 'Leak', description: 'd', contact_phone: '999',
    applicant_name: 'Ann', applicant_email: 'a@x', applicant_phone: '1', open_change_request_id: 5 };
  const out = buildTicketDetails(V(applicant, t), t, {
    attachments: [
      { id: 1, file_url: '/uploads/tickets/1/applicant_evidence/1-2-a.jpg', document_category: 'APPLICANT_EVIDENCE', uploaded_by: 100 },
      { id: 2, file_url: '/uploads/tickets/1/je_reports/site_photos/1-2-b.jpg', document_category: 'JE_SITE_PHOTO', uploaded_by: 10, uploader_role: 'JE' },
    ],
    reports: [{ estimated_amount: 120000 }], tenders: [{ id: 1 }], bills: [{ id: 1 }],
    auditLogs: [A('FORWARDED')], messages: [msg('PUBLIC_NOTE', 0), msg('INTERNAL_REMARK', 4)],
  });
  assert.equal(out.stage_label, 'Under review');
  assert.equal(out.assigned_je_id, undefined);
  assert.equal(out.current_desk_user_id, undefined);
  assert.equal(out.applicant_email, undefined);
  assert.equal(out.report, null);
  assert.deepEqual([out.tenders, out.bills, out.audit_logs], [[], [], []]);
  assert.deepEqual(out.attachments.map((a) => a.id), [1]);
  assert.equal(out.attachments[0].download_url, '/api/attachments/1');
  assert.equal(out.attachments[0].file_url, undefined);
  assert.deepEqual(out.messages.map((m) => m.kind), ['PUBLIC_NOTE']);
  assert.equal(out.reminder_count, null);
  assert.equal(buildTicketDetails(V(otherJe, t), t, { attachments: [], reports: [], tenders: [], bills: [], auditLogs: [], messages: [] }), null);
});

test('details payload: JE gets no bills; Clerical loses applicant contact', () => {
  const t = { ...ticket({ status: 'WORK_IN_PROGRESS' }), applicant_phone: '1', applicant_email: 'a@x', contact_phone: '9' };
  const data = { attachments: [], reports: [{ id: 1 }], tenders: [{ id: 1 }], bills: [{ id: 1 }], auditLogs: [], messages: [] };
  const forJe = buildTicketDetails(V(je, t), t, data);
  assert.deepEqual(forJe.bills, []);
  assert.deepEqual(forJe.tenders, [{ id: 1 }]);
  assert.equal(forJe.applicant_phone, '1');
  const forClerk = buildTicketDetails(V(clerk, t), t, data);
  assert.equal(forClerk.applicant_phone, undefined);
  assert.equal(forClerk.contact_phone, undefined);
  assert.deepEqual(forClerk.bills, [{ id: 1 }]);
  assert.equal(redactQueueRow({ role: 'CLERICAL' }, { id: 1, applicant_phone: '1', applicant_email: 'e' }).applicant_phone, undefined);
  assert.equal(redactQueueRow({ role: 'DEAN' }, { id: 1, applicant_phone: '1' }).applicant_phone, '1');
});

test('reminder schedule: instant, +12h, +24h, +72h, then every 24h; AE copied from #4', () => {
  const t0 = new Date('2026-01-01T00:00:00Z');
  const h = (n) => (reminderDueAt(t0, n) - t0) / 3600e3;
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(h), [0, 12, 24, 72, 96, 120, 144]);
  assert.deepEqual([1, 2, 3, 4, 5, 10].map(copiesAe), [false, false, false, true, true, true]);
});

test('applicant email: stage + portal link only, whatever the ticket holds', () => {
  process.env.FRONTEND_URL = 'https://portal.example';
  for (const status of ['ASSIGNED_TO_JE', 'PENDING_DEAN_APPROVAL', 'APPROVED_FOR_TENDERING', 'DENIED', 'CLOSED']) {
    const { subject, body } = applicantStageEmail(42, status);
    assert.ok(body.includes(stageLabel(status)));
    assert.ok(body.includes('https://portal.example/ticket/42'));
    assert.ok(!/₹|INR|Rs\.?\s?\d|@|Phone|Engineer|Dean |Director|remark/i.test(subject + body), body);
  }
  assert.equal(stageLabel('PENDING_SE_APPROVAL'), stageLabel('PENDING_DEAN_APPROVAL'));
});

test('upload allow-list (S3): .html/.svg/exe rejected, spoofed MIME rejected, images/pdf accepted', () => {
  const run = (originalname, mimetype) => { let r; fileFilter({}, { originalname, mimetype }, (e, ok) => { r = { e, ok }; }); return r; };
  assert.equal(run('x.jpg', 'image/jpeg').ok, true);
  assert.equal(run('Plan.PDF', 'application/pdf').ok, true);
  for (const [n, m] of [['x.html', 'text/html'], ['x.svg', 'image/svg+xml'], ['x.exe', 'application/octet-stream'], ['x.jpg', 'text/html'], ['noext', 'image/jpeg']]) {
    const r = run(n, m);
    assert.equal(r.ok, undefined, n);
    assert.equal(r.e.code, 'UNSUPPORTED_FILE_TYPE');
  }
});
