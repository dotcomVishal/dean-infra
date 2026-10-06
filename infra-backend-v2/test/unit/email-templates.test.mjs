// Template rules (plan 4.5): one professional layout, HTML and text parts, escaped values, nothing private.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build, applicantEventEmail } from '../../src/services/emailTemplates.js';
import { TEMPLATES } from '../../src/emails/index.js';
import { inr } from '../../src/emails/labels.js';
import { EVENT } from '../../src/services/emailPolicy.js';
import { buildDigest, isoWeekKey, weekRangeLabel } from '../../src/services/digestBuilder.js';

process.env.FRONTEND_URL = 'https://portal.example';

const long = 'x'.repeat(2000);
const t = { id: 42, name: 'Asha Rao', title: 'Water leak in Lab B2-104', department: 'Civil', campus: 'NORTH', landmark: 'Near A1 main gate' };
const SAMPLE = {
  'applicant/received': t, 'applicant/resolved': t, 'applicant/rejected': t, 'applicant/closed': t,
  'je/assigned': t,
  'je/transferred': { ...t, status: 'WORK_IN_PROGRESS' },
  'je/reassigned-away': t, 'je/approved': t, 'je/rejected': t, 'je/closed': t,
  'je/sent-back': { ...t, comment: 'Split the estimate\nmaterial and labour.', status: 'ASSIGNED_TO_JE', inspection: true },
  'je/reminder': { ...t, number: 3, hours: 24 },
  'desk/changes-requested': { ...t, fromDesk: 'DEAN', message: long, toJe: true },
  'desk/arrival': { ...t, estimate: 125000 },
  'desk/needs-je': t,
  'desk/new-ticket': { ...t, jeName: 'Ravi Kumar' },
};
const digestMail = () => buildDigest('AE', {
  name: 'Asha Rao', counts: [['Awaiting your review', 4], ['Late', 2]],
  oldest: Array.from({ length: 14 }, (_, i) => ({ id: i + 1, days: i, label: 'awaiting your review' })),
}, new Date('2026-10-05T04:00:00Z'));

const everyMail = () => [
  ...Object.entries(SAMPLE).map(([name, d]) => [name, build(name, d)]),
  ['digest', digestMail()],
];
const hrefs = (html) => [...new Set([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]))];
const textUrls = (text) => [...new Set(text.match(/https?:\/\/\S+/g) ?? [])];
const unwrap = (html) => html.replace(/<[^>]+>/g, ' ');

test('the registry and the samples cover the same seventeen mails', () => {
  assert.equal(Object.keys(TEMPLATES).length, 17);
  assert.deepEqual([...Object.keys(SAMPLE), 'digest'].sort(), Object.keys(TEMPLATES).sort());
});

test('every mail: subject, both parts, one link target, signature, footer, no emoji, no exclamation mark', () => {
  for (const [name, { subject, body, html }] of everyMail()) {
    assert.ok(subject.length <= 70, `${name}: ${subject.length}`);
    assert.ok(name === 'digest' ? subject.startsWith('[Infra] Weekly summary, ') : subject.startsWith('[Infra] TKT-0042: '), subject);
    assert.ok(body && html.startsWith('<!doctype html>'), `${name}: both parts`);
    for (const part of [body, unwrap(html)]) {
      assert.ok(part.includes('Deanery of Infrastructure, IIT Mandi'), `${name}: signature`);
      assert.ok(part.includes('This is an automated message from the Infrastructure portal.'), `${name}: footer`);
      assert.ok(!/\p{Extended_Pictographic}/u.test(part), `${name}: emoji`);
      assert.ok(!part.includes('!'), `${name}: exclamation mark`);
    }
    assert.ok(textUrls(body).length <= 1, `${name}: text links ${textUrls(body)}`);
    assert.ok(hrefs(html).length <= 1, `${name}: html links ${hrefs(html)}`);
    if (textUrls(body).length) assert.deepEqual(hrefs(html), textUrls(body), `${name}: same target`);
    assert.match(html, /<meta name="color-scheme" content="light">/);
    assert.match(html, /src="https:\/\/portal\.example\/logo\.png"/);
  }
});

test('every mail starts with a greeting and states what happened within 120 words', () => {
  for (const [name, { body }] of everyMail()) {
    assert.match(body, /^Dear Asha Rao,\n/, name);
    // Body words: greeting to signature, without the facts, a quoted remark or the link lines.
    const prose = body.split('\n\n').slice(1, -2)
      .filter((p) => !/^[A-Z][\w ]*: /.test(p) && !p.startsWith('"') && !/^https?:/.test(p) && !/^Open the /.test(p))
      .join(' ');
    assert.ok(prose.split(/\s+/).length <= 120, `${name}: ${prose.split(/\s+/).length} words`);
  }
});

test('a missing name falls back to "Hello,"', () => {
  assert.match(build('je/closed', { ...t, name: '' }).body, /^Hello,\n/);
});

test('values typed by users are escaped in the HTML', () => {
  const evil = '<script>x</script>';
  for (const [name, d] of [
    ['je/assigned', { ...t, title: evil, landmark: evil }],
    ['je/sent-back', { ...t, title: evil, comment: evil, status: 'ASSIGNED_TO_JE' }],
    ['desk/changes-requested', { ...t, title: evil, message: evil, fromDesk: 'AE' }],
    ['applicant/closed', { ...t, title: evil, name: evil }],
  ]) {
    const { html, body } = build(name, d);
    assert.ok(!html.includes('<script>'), name);
    assert.ok(html.includes('&lt;script&gt;'), name);
    assert.ok(body.includes(evil) || name === 'applicant/closed', name);
  }
});

test('long title and remark are cut: title 80 characters, remark 300', () => {
  const m = build('je/sent-back', { ...t, title: long, comment: long, status: 'ASSIGNED_TO_JE' });
  assert.ok(!m.body.includes('x'.repeat(301)));
  assert.ok(m.body.includes('x'.repeat(300)));
  assert.ok(m.body.includes(`Subject: ${'x'.repeat(79)}…`));
});

test('an empty fact row is left out', () => {
  const { body } = build('je/assigned', { ...t, landmark: '' });
  assert.ok(!body.includes('Location:'));
  assert.match(body, /Campus: North/);
});

test('assignment mail carries the ticket facts but not the description', () => {
  const { body, html } = build('je/assigned', { ...t, description: 'SECRET DETAIL' });
  assert.match(body, /Ticket: TKT-0042\nSubject: Water leak in Lab B2-104\nDepartment: Civil\nCampus: North\nLocation: Near A1 main gate/);
  assert.ok(!body.includes('SECRET DETAIL') && !html.includes('SECRET DETAIL'));
  assert.match(body, /Open the ticket: https:\/\/portal\.example\/ticket\/42/);
});

test('amounts use Indian grouping', () => {
  assert.equal(inr(125000), '₹1,25,000');
  assert.match(build('desk/arrival', SAMPLE['desk/arrival']).body, /Estimate: ₹1,25,000/);
  assert.equal(inr(null), '');
});

test('desk names and stage labels read as the portal shows them', () => {
  assert.equal(build('desk/changes-requested', SAMPLE['desk/changes-requested']).subject, '[Infra] TKT-0042: Returned by the Dean for changes');
  assert.match(build('je/transferred', SAMPLE['je/transferred']).body, /Current stage: Awarded/);
});

test('reminders and the extra lines appear only where they apply', () => {
  assert.match(build('je/sent-back', SAMPLE['je/sent-back']).body, /Reminders will be sent until your report is submitted\./);
  assert.ok(!build('je/sent-back', { ...SAMPLE['je/sent-back'], inspection: false }).body.includes('Reminders'));
  assert.match(build('desk/changes-requested', SAMPLE['desk/changes-requested']).body, /Reminders will continue/);
  assert.ok(!build('desk/changes-requested', { ...SAMPLE['desk/changes-requested'], toJe: false }).body.includes('Reminders'));
  assert.equal(build('je/reminder', SAMPLE['je/reminder']).subject, '[Infra] TKT-0042: Reminder 3: report pending for 24 hours');
  assert.equal(build('je/reassigned-away', t).html.includes('<a '), false, 'no button');
});

test('applicant mails carry no staff name, amount, phone number or e-mail address', () => {
  const staffy = { id: 42, title: t.title, name: 'Asha Rao', staffName: 'Ravi Kumar', estimate: 125000, phone: '9876543210', email: 'je@x.edu', message: 'REMARK', jeName: 'Ravi Kumar', comment: 'COMMENT', department: 'Civil' };
  for (const event of [EVENT.RECEIVED, EVENT.RESOLVED, EVENT.REJECTED, EVENT.CLOSED]) {
    const { subject, body, html } = applicantEventEmail(event, staffy);
    for (const part of [subject, body, unwrap(html)]) {
      assert.ok(!/Ravi|₹|125000|9876543210|@|REMARK|COMMENT|Civil|Estimate/.test(part), `${event}: ${part}`);
    }
    assert.ok(body.includes('Open') || body.includes('https://portal.example/ticket/42'));
  }
});

test('applicant builder has no way to carry staff data', () => {
  assert.equal(applicantEventEmail.length, 2);
  assert.throws(() => applicantEventEmail('ARRIVAL', t));
});

test('digest: counts first, zero rows dropped, at most 10 oldest lines, empty -> null', () => {
  const now = new Date('2026-10-05T04:00:00Z'); // Monday 09:30 IST
  assert.equal(buildDigest('AE', { counts: [['Awaiting your review', 0]], oldest: [] }, now), null);
  const mail = buildDigest('AE', {
    name: 'Asha Rao',
    counts: [['Awaiting your review', 4], ['Unassigned in your scope', 0], ['Late', 2]],
    oldest: Array.from({ length: 14 }, (_, i) => ({ id: i + 1, days: i, label: 'awaiting your review' })),
  }, now);
  assert.equal(mail.subject, '[Infra] Weekly summary, 5 Oct to 11 Oct');
  const lines = mail.body.split('\n');
  assert.ok(lines.includes('Awaiting your review: 4'));
  assert.ok(lines.includes('Late: 2'));
  assert.ok(!mail.body.includes('Unassigned'));
  assert.equal(lines.filter((l) => /^TKT-/.test(l)).length, 10);
  assert.match(mail.body, /TKT-0014, 13 days, awaiting your review/); // oldest first
  assert.match(mail.body, /Open the portal: https:\/\/portal\.example\/approvals/);
  assert.ok(mail.body.includes('Open the portal to act on these.'));
  assert.match(mail.html, /Oldest pending/);
  assert.match(mail.html, /href="https:\/\/portal\.example\/approvals"/);
});

test('ISO week key and range label use the IST calendar', () => {
  assert.equal(isoWeekKey(new Date('2026-10-05T04:00:00Z')), '2026-W41');
  assert.equal(isoWeekKey(new Date('2026-10-04T20:00:00Z')), '2026-W41'); // Mon 01:30 IST
  assert.equal(isoWeekKey(new Date('2026-10-04T17:00:00Z')), '2026-W40'); // Sun 22:30 IST
  assert.equal(weekRangeLabel(new Date('2026-10-08T10:00:00Z')), '5 Oct to 11 Oct');
  assert.equal(isoWeekKey(new Date('2026-12-31T10:00:00Z')), '2026-W53');
});
