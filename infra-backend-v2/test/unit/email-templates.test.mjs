// Template rules (Master-plan Phase 4): plain text, short, one link, nothing private.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../src/services/emailTemplates.js';
import { EVENT } from '../../src/services/emailPolicy.js';
import { buildDigest, isoWeekKey, weekRangeLabel } from '../../src/services/digestBuilder.js';

process.env.FRONTEND_URL = 'https://portal.example';

const ticket = { id: 42, title: 'Water leak in Lab B2-104', department: 'Civil', campus: 'NORTH', landmark: 'Near A1 main gate' };
const long = 'x'.repeat(2000);

const samples = () => [
  T.jeAssignedEmail(ticket),
  T.jeAssignedEmail({ ...ticket, title: long, landmark: long }),
  T.jeReassignedAwayEmail(42),
  T.changesRequestedEmail({ ticketId: 42, fromDesk: 'AE', message: 'Split the estimate\nmaterial and labour.' }),
  T.changesRequestedEmail({ ticketId: 42, fromDesk: 'DIRECTOR', message: long }),
  T.jeOutcomeEmail({ ticketId: 42, approved: true }),
  T.jeOutcomeEmail({ ticketId: 42, approved: false }),
  T.jeSentBackEmail({ ticketId: 42, comment: long }),
  T.jeReminderEmail({ ticketId: 42, number: 3, hoursPending: 24 }),
  T.arrivalEmail({ ticketId: 42, title: ticket.title }),
  T.arrivalEmail({ ticketId: 42, title: long, unassigned: true }),
  ...[EVENT.RECEIVED, EVENT.RESOLVED, EVENT.REJECTED, EVENT.CLOSED].map((e) => T.applicantEventEmail(42, e)),
];

test('every template is plain text with a short subject, one link and a signature', () => {
  for (const { subject, body } of samples()) {
    const text = `${subject}\n${body}`;
    assert.ok(subject.startsWith('[Infra] TKT-0042: '), subject);
    assert.ok(subject.length <= 70, `${subject.length}: ${subject}`);
    assert.ok(!/</.test(text), 'no markup');
    assert.ok(!/={3,}/.test(text), 'no banners');
    assert.ok(!/^\s*[•\-*]\s/m.test(body), 'no bullets');
    assert.ok(!/\p{Extended_Pictographic}/u.test(text), 'no emoji');
    assert.ok(body.trimEnd().endsWith('Deanery of Infrastructure, IIT Mandi'), 'signature');
    assert.ok((body.match(/https?:\/\//g) ?? []).length <= 1, 'at most one link');
    assert.ok(body.split('\n').filter((l) => l.trim()).length <= 6, `at most 6 lines:\n${body}`);
    assert.ok(!/(\+?\d[\d\s()-]{8,})\d/.test(body.replace(/https?:\S+/g, '')), 'no phone number');
    assert.ok(!/@/.test(body), 'no e-mail address');
  }
});

test('assignment mail carries the ticket facts but not the description', () => {
  const { body } = T.jeAssignedEmail({ ...ticket, description: 'SECRET DETAIL' });
  assert.match(body, /TKT-0042, Water leak in Lab B2-104\./);
  assert.match(body, /Civil, North campus\. Near A1 main gate\./);
  assert.ok(!body.includes('SECRET DETAIL'));
  assert.match(body, /https:\/\/portal\.example\/ticket\/42/);
});

test('applicant builder has no way to carry staff data', () => {
  assert.equal(T.applicantEventEmail.length, 2);
  assert.throws(() => T.applicantEventEmail(42, 'ARRIVAL'));
});

test('digest: counts first, zero rows dropped, at most 10 oldest lines, empty -> null', () => {
  const now = new Date('2026-10-05T04:00:00Z'); // Monday 09:30 IST
  assert.equal(buildDigest('AE', { counts: [['Awaiting your review', 0]], oldest: [] }, now), null);
  const oldest = Array.from({ length: 14 }, (_, i) => ({ id: i + 1, days: i, label: 'awaiting your review' }));
  const mail = buildDigest('AE', { counts: [['Awaiting your review', 4], ['Unassigned in your scope', 0], ['Late', 2]], oldest }, now);
  assert.equal(mail.subject, '[Infra] Weekly summary, 5 Oct to 11 Oct');
  const lines = mail.body.split('\n');
  assert.equal(lines[0], 'Awaiting your review: 4');
  assert.equal(lines[1], 'Late: 2');
  assert.ok(!mail.body.includes('Unassigned'));
  assert.equal(lines.filter((l) => /^TKT-/.test(l)).length, 10);
  assert.match(mail.body, /TKT-0014, 13 days, awaiting your review/); // oldest first
  assert.match(mail.body, /https:\/\/portal\.example\/approvals/);
  assert.ok(mail.body.trimEnd().endsWith('Deanery of Infrastructure, IIT Mandi'));
});

test('ISO week key and range label use the IST calendar', () => {
  assert.equal(isoWeekKey(new Date('2026-10-05T04:00:00Z')), '2026-W41');
  assert.equal(isoWeekKey(new Date('2026-10-04T20:00:00Z')), '2026-W41'); // Mon 01:30 IST
  assert.equal(isoWeekKey(new Date('2026-10-04T17:00:00Z')), '2026-W40'); // Sun 22:30 IST
  assert.equal(weekRangeLabel(new Date('2026-10-08T10:00:00Z')), '5 Oct to 11 Oct');
  assert.equal(isoWeekKey(new Date('2026-12-31T10:00:00Z')), '2026-W53');
});
