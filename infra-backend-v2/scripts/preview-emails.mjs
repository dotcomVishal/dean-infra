// Renders all seventeen mails with sample data into tmp/email-preview/ (HTML and text, plus an index).
//   npm run email:preview
// Includes a title with markup in it and a 2,000-character remark, the two inputs that break layouts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../src/services/emailTemplates.js';
import { buildDigest } from '../src/services/digestBuilder.js';

process.env.FRONTEND_URL ||= 'https://infraseva.iitmandi.co.in';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tmp', 'email-preview');
fs.mkdirSync(out, { recursive: true });

const t = { id: 42, name: 'Asha Rao', title: 'Water leak in Lab B2-104', department: 'Civil', campus: 'NORTH', landmark: 'Near A1 main gate' };
const evil = { ...t, title: '<script>alert(1)</script> Leak <b>bold</b>', landmark: '<img src=x onerror=alert(1)>' };
const long = 'The estimate needs to be split into material and labour. '.repeat(40).slice(0, 2000);

const samples = {
  'applicant/received': t, 'applicant/resolved': t, 'applicant/rejected': t, 'applicant/closed': t,
  'je/assigned': t, 'je/transferred': { ...t, status: 'WORK_IN_PROGRESS' },
  'je/reassigned-away': t, 'je/approved': t, 'je/rejected': t, 'je/closed': t,
  'je/sent-back': { ...t, comment: 'The leak is back after one day.\nPlease check the joint again.', status: 'ASSIGNED_TO_JE', inspection: true },
  'je/reminder': { ...t, number: 3, hours: 72 },
  'desk/changes-requested': { ...t, fromDesk: 'AE', message: 'Split the estimate into material and labour.', toJe: true },
  'desk/arrival': { ...t, estimate: 125000 },
  'desk/needs-je': t, 'desk/new-ticket': { ...t, jeName: 'Ravi Kumar' },
  'extra/markup-in-title': ['je/assigned', evil],
  'extra/long-remark': ['desk/changes-requested', { ...t, fromDesk: 'DIRECTOR', message: long, toJe: false }],
};

const mails = Object.entries(samples).map(([name, v]) => {
  const [template, data] = Array.isArray(v) ? v : [name, v];
  return [name, build(template, data)];
});
mails.push(['digest', buildDigest('AE', {
  name: 'Asha Rao',
  counts: [['Awaiting your review', 4], ['Unassigned in your scope', 1], ['JE tickets pending over 72 hours', 2]],
  oldest: Array.from({ length: 12 }, (_, i) => ({ id: 40 - i, days: 14 - i, label: 'awaiting your review' })),
}, new Date())]);

for (const [name, m] of mails) {
  const file = name.replace('/', '-');
  fs.writeFileSync(path.join(out, `${file}.html`), m.html);
  fs.writeFileSync(path.join(out, `${file}.txt`), `Subject: ${m.subject}\n\n${m.body}`);
}
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Mail preview</title>
<body style="font-family:sans-serif;max-width:720px;margin:24px auto"><h1>Mail preview</h1><ul>${
  mails.map(([name, m]) => `<li><a href="${name.replace('/', '-')}.html">${name}</a>: ${m.subject.replace(/</g, '&lt;')} (<a href="${name.replace('/', '-')}.txt">text</a>)</li>`).join('')
}</ul></body>`);
console.log(`Wrote ${mails.length} mails to ${out}`);
