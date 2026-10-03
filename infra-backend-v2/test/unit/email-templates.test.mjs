// Every mail is plain text in one style: `[Infra]` subject under 70 characters, a short body, no banner,
// no markup, no salutation, the time in IST, one link, one-line footer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applicantStageEmail, resolvedConfirmEmail, autoClosedEmail, jeAssignmentEmail, unassignedEmail,
  jeReassignedAwayEmail, changeRequestEmail, movementEmail, reminderEmail, weeklyDigestEmail,
  fmtIst, fmtDay, FOOTER,
} from '../../src/services/emailTemplates.js';

process.env.FRONTEND_URL = 'https://portal.example';
const T = {
  id: 42, title: 'Water leakage near B3 staircase', department: 'Civil', campus: 'NORTH', priority: 'NORMAL', type: 'recurring',
  landmark: 'behind B3 mess', applicantName: 'R. Sharma', applicantPhone: '9800000021', createdAt: new Date('2026-09-30T08:40:00Z'),
};

const ALL = {
  'applicant received': applicantStageEmail(42, 'ASSIGNED_TO_JE', T.title),
  'applicant rejected': applicantStageEmail(42, 'DENIED', T.title),
  'applicant closed': applicantStageEmail(42, 'CLOSED', T.title),
  'resolved (applicant)': resolvedConfirmEmail({ ticketId: 42, title: T.title, kind: 'COMPLETED', autoCloseOn: new Date('2026-10-09T08:00:00Z') }),
  'resolved reminder 3': resolvedConfirmEmail({ ticketId: 42, title: T.title, kind: 'COMPLETED', autoCloseOn: new Date('2026-10-09T08:00:00Z'), number: 3 }),
  'resolved (cancelled tender)': resolvedConfirmEmail({ ticketId: 42, title: T.title, kind: 'TENDER_CANCELLED', autoCloseOn: new Date('2026-10-09T08:00:00Z') }),
  'resolved (AE)': resolvedConfirmEmail({ ticketId: 42, title: T.title, kind: 'COMPLETED', autoCloseOn: new Date('2026-10-09T08:00:00Z'), forAe: true }),
  'auto closed': autoClosedEmail({ ticketId: 42, title: T.title, resolvedAt: new Date('2026-10-02T08:00:00Z'), days: 7 }),
  'JE assigned': jeAssignmentEmail(T),
  'JE proposal': jeAssignmentEmail({ ...T, type: 'non-recurring' }),
  unassigned: unassignedEmail(T),
  'JE reassigned away': jeReassignedAwayEmail({ ticketId: 42, title: T.title, at: new Date('2026-10-01T04:35:00Z') }),
  'change request': changeRequestEmail({ ticketId: 42, title: T.title, fromDesk: 'AE', message: 'Add the drainage estimate and two close-up photos.' }),
  approved: movementEmail({ ticketId: 42, title: T.title, desk: 'JE', headline: 'Approved', at: new Date('2026-10-01T04:35:00Z') }),
  'sent back': movementEmail({ ticketId: 42, title: T.title, desk: 'JE', headline: 'Sent back by the applicant' }),
  'JE reminder': reminderEmail({ ticketId: 42, title: T.title, number: 3, hoursPending: 24, since: new Date('2026-09-30T08:40:00Z') }),
  digest: weeklyDigestEmail({
    roleLabel: 'AE', scopeLabel: 'North Civil', confirm: 1,
    rows: [{ id: 31, title: 'Roof seepage, Library', days: 12 }, { id: 42, title: 'Water leakage, B3', days: 3 }, { id: 50, title: 'Drain cover, Mess 1', days: 1 }],
    counts: { withJes: 6, awaitingApplicant: 2, sentBack: 1 },
  }),
};

for (const [name, m] of Object.entries(ALL)) {
  test(`style: ${name}`, () => {
    assert.ok(m.subject.startsWith('[Infra] '), m.subject);
    assert.ok(m.subject.length < 70, `subject ${m.subject.length} chars: ${m.subject}`);
    assert.ok(m.body.endsWith(`\n\n${FOOTER}`), 'one-line footer');
    const lines = m.body.slice(0, -FOOTER.length).split('\n').filter((l) => l.trim() !== '');
    assert.ok(lines.length <= 8, `${lines.length} lines`);
    assert.ok(!/={3,}|-{3,}|^\s*[•*]\s/m.test(m.body), 'no banner or bullets');
    assert.ok(!/^(Dear|Hello|Hi)\b/m.test(m.body), 'no salutation');
    assert.ok(!/<[a-z][^>]*>/i.test(m.body), 'no markup');
    // one link; the "reassigned, no action needed" notice has none, by design
    assert.equal((m.body.match(/https?:\/\//g) ?? []).length, name === 'JE reassigned away' ? 0 : 1, 'links');
  });
}

test('time is shown in IST, whatever the server zone', () => {
  assert.equal(fmtIst(new Date('2026-09-30T08:40:00Z')), '30 Sep 2026 14:10');
  assert.equal(fmtIst(new Date('2026-09-30T20:00:00Z')), '01 Oct 2026 01:30', 'crosses midnight in IST');
  assert.equal(fmtDay(new Date('2026-10-09T00:00:00Z')), '09 Oct 2026');
  assert.match(ALL['JE assigned'].body, /Raised by R\. Sharma, 9800000021, on 30 Sep 2026 14:10/);
});

test('the JE assignment matches the agreed example', () => {
  assert.equal(ALL['JE assigned'].subject, '[Infra] #TKT-0042 assigned to you');
  assert.deepEqual(ALL['JE assigned'].body.split('\n').slice(0, 6), [
    '#TKT-0042 Water leakage near B3 staircase',
    'North campus, Civil, Priority Normal',
    'Landmark: behind B3 mess',
    'Raised by R. Sharma, 9800000021, on 30 Sep 2026 14:10',
    'Action: inspect the site and submit your report.',
    'https://portal.example/je/ticket/42',
  ]);
});

test('applicant mails carry no staff name, amount, phone, remark or email address', () => {
  for (const name of ['applicant received', 'applicant rejected', 'applicant closed', 'resolved (applicant)', 'resolved reminder 3',
    'resolved (cancelled tender)', 'auto closed']) {
    const { subject, body } = ALL[name];
    assert.ok(!/₹|INR|Rs\.?\s?\d|@|Phone|Engineer|Sharma|remark/i.test(subject + body), `${name}: ${body}`);
  }
});

test('weekly digest lists oldest first and the scope counts', () => {
  const d = ALL.digest;
  assert.equal(d.subject, '[Infra] Weekly summary: 3 tickets at your desk');
  assert.match(d.body, /At your desk \(AE, North Civil\), oldest first:/);
  assert.match(d.body, /Waiting for your confirmation: 1\./);
  assert.match(d.body, /In your scope: 6 with JEs, 2 awaiting the applicant, 1 sent back\./);
  assert.ok(d.body.indexOf('#TKT-0031') < d.body.indexOf('#TKT-0042'));
});
