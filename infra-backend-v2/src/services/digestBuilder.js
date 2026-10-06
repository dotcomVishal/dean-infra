// Pure digest helpers: dates in IST and the mail text. No database, so unit tests can import
// them without opening a connection pool (which would keep the test process alive).
import { build, portalUrl } from './emailTemplates.js';

export const DAY = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export const OVERDUE_JE_HOURS = 72;
const MAX_ITEMS = 10;

// ---- dates (IST) --------------------------------------------------------------------------
export const istParts = (date) => {
  const d = new Date(date.getTime() + IST_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate(), dow: d.getUTCDay(), hour: d.getUTCHours() };
};

/** ISO week key such as "2026-W41", from the IST calendar date. */
export function isoWeekKey(date) {
  const p = istParts(date);
  const d = new Date(Date.UTC(p.y, p.m, p.day));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // the Thursday of this ISO week
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d - yearStart) / DAY + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "5 Oct to 11 Oct": Monday to Sunday of the IST week containing `date`. */
export function weekRangeLabel(date) {
  const p = istParts(date);
  const monday = new Date(Date.UTC(p.y, p.m, p.day - ((p.dow + 6) % 7)));
  const sunday = new Date(monday.getTime() + 6 * DAY);
  const f = (d) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return `${f(monday)} to ${f(sunday)}`;
}

// ---- pure builder -------------------------------------------------------------------------
// Each role passes the same lists:
//   name:   the recipient's name, for the greeting
//   counts: [[label, n], ...]            shown first, zero rows are dropped
//   oldest: [{ id, days, label }, ...]   at most 10 lines, oldest first
const LINK = Object.freeze({
  AE: '/approvals', SE: '/approvals', DEAN: '/approvals', CLERICAL: '/clerical', ACCOUNTANT: '/finance',
});

/**
 * @returns {{subject:string, body:string, html:string}|null} null when there is nothing to report
 */
export function buildDigest(role, data, now = new Date()) {
  const counts = (data.counts ?? []).filter(([, n]) => n > 0);
  if (counts.length === 0) return null;
  const oldest = [...(data.oldest ?? [])].sort((a, b) => b.days - a.days).slice(0, MAX_ITEMS);
  return build('digest', {
    name: data.name, range: weekRangeLabel(now), counts, oldest, link: `${portalUrl()}${LINK[role] ?? ''}`,
  });
}
