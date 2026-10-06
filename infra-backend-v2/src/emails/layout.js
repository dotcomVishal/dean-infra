// One layout for every mail: a content object in, an HTML part and a text part out,
// so the two cannot drift and every mail looks the same (plan 4.5).
//
// content = {
//   heading, name, paragraphs: [], facts: [[label, value]], quote, after: [],
//   button: { label, href, plainLabel? } | null, table: { title, head, rows, text } | null,
//   wideFacts: boolean   (counts: long labels, value on the right)
// }
// Tables for layout and inline styles only: mail clients drop <style> blocks and flexbox.
import { SIGNATURE, FOOTER, portalUrl, oneLine } from './common.js';

export const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const FONT = "-apple-system,'Segoe UI',Roboto,Arial,sans-serif";
const greeting = (name) => (name ? `Dear ${oneLine(name, 80)},` : 'Hello,');
const liveFacts = (facts) => (facts ?? []).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');
const QUOTE_MAX = 300;
const quoteText = (q) => String(q ?? '').replace(/\r\n?/g, '\n').trim().slice(0, QUOTE_MAX);

export function renderText(c) {
  const out = [greeting(c.name), ''];
  for (const p of c.paragraphs ?? []) out.push(p, '');
  const facts = liveFacts(c.facts);
  if (facts.length) { out.push(...facts.map(([l, v]) => `${l}: ${v}`), ''); }
  if (c.quote) out.push(`"${quoteText(c.quote)}"`, '');
  for (const p of c.after ?? []) out.push(p, '');
  if (c.table?.rows?.length) out.push(`${c.table.title}:`, ...c.table.text, '');
  if (c.button) out.push(`${c.button.plainLabel ?? 'Open the ticket'}: ${c.button.href}`, '');
  out.push(SIGNATURE, '', FOOTER);
  return `${out.join('\n')}\n`;
}

const td = (style, inner, attrs = '') => `<td ${attrs} style="${style}">${inner}</td>`;

function factsHtml(facts, wide) {
  if (!facts.length) return '';
  const rows = facts.map(([l, v]) => `<tr>${
    td(`padding:8px 12px 8px 0;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b;vertical-align:top;${wide ? '' : 'width:130px;'}`, esc(l))
  }${
    td(`padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:#0f172a;vertical-align:top;${wide ? 'text-align:right;white-space:nowrap;' : ''}`, esc(v))
  }</tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border-top:1px solid #e2e8f0">${rows}</table>`;
}

function tableHtml(t) {
  if (!t?.rows?.length) return '';
  const head = t.head.map((h) => td('padding:6px 8px 6px 0;font-size:12px;color:#64748b;text-align:left;border-bottom:1px solid #e2e8f0', esc(h))).join('');
  const rows = t.rows.map((r) => `<tr>${r.map((cell) => td('padding:6px 8px 6px 0;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0', esc(cell))).join('')}</tr>`).join('');
  return `<p style="margin:20px 0 4px;font-size:14px;font-weight:600;color:#0f172a">${esc(t.title)}</p>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${head}</tr>${rows}</table>`;
}

export function renderHtml(c) {
  const p = (t) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1f2937">${esc(t)}</p>`;
  const facts = liveFacts(c.facts);
  const quote = c.quote
    ? `<blockquote style="margin:16px 0;padding:4px 0 4px 14px;border-left:3px solid #cbd5e1;font-size:15px;line-height:1.6;color:#334155">${esc(quoteText(c.quote)).replace(/\n/g, '<br>')}</blockquote>`
    : '';
  const button = c.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 8px"><tr><td style="background:#1d4ed8;border-radius:6px"><a href="${esc(c.button.href)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;font-family:${FONT}">${esc(c.button.label)}</a></td></tr></table>`
      + `<p style="margin:0 0 20px;font-size:12px;color:#64748b;word-break:break-all">${esc(c.button.href)}</p>`
    : '';
  const preheader = esc(oneLine((c.paragraphs ?? [])[0] ?? c.heading, 140));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(c.heading)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f1f5f9">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0">
<tr><td style="padding:16px 28px;border-bottom:1px solid #e2e8f0"><img src="${esc(portalUrl())}/logo.png" width="64" height="44" alt="IIT Mandi" style="display:block;border:0"></td></tr>
<tr><td style="padding:24px 28px 8px;font-family:${FONT}">
<h1 style="margin:0 0 18px;font-size:20px;font-weight:600;line-height:1.3;color:#0f172a">${esc(c.heading)}</h1>
<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1f2937">${esc(greeting(c.name))}</p>
${(c.paragraphs ?? []).map(p).join('')}${factsHtml(facts, c.wideFacts)}${quote}${(c.after ?? []).map(p).join('')}${tableHtml(c.table)}${button}
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#1f2937">${esc(SIGNATURE)}</p>
</td></tr>
<tr><td style="padding:14px 28px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.5;color:#64748b;font-family:${FONT}">${esc(FOOTER)}</td></tr>
</table></td></tr></table></body></html>`;
}

/** @returns {{ body: string, html: string }} */
export const render = (content) => ({ body: renderText(content), html: renderHtml(content) });
