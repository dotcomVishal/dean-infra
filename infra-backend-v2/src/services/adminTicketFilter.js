// One filter for the Sysadmin ticket list AND its CSV export, so the file can never
// differ from what the screen shows. Unknown values are a 400, not an empty result.
import { z } from 'zod';
import { STATUS } from '../config/workflow.js';

const DEPARTMENTS = ['Civil', 'Electrical', 'Horticulture'];
const CAMPUSES = ['NORTH', 'SOUTH'];
const PRIORITIES = ['LOW', 'NORMAL', 'URGENT'];
const TYPES = ['recurring', 'non-recurring'];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// The UI sends 'ALL' (or nothing) for "no filter".
const blank = (v) => (v === undefined || v === null || v === '' || v === 'ALL' ? undefined : v);
const one = (values) => z.preprocess(blank, z.enum(values).optional());
// status accepts one value, a comma list, or a repeated parameter.
const statusList = z.preprocess((v) => {
  if (blank(v) === undefined) return undefined;
  const parts = (Array.isArray(v) ? v : [v]).flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts.filter((x) => x !== 'ALL') : undefined;
}, z.array(z.enum(Object.values(STATUS))).min(1).optional());
const isoDay = z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
  }, 'is not a real date').optional());

const schema = z.object({
  status: statusList,
  department: one(DEPARTMENTS),
  campus: one(CAMPUSES),
  priority: one(PRIORITIES),
  type: one(TYPES),
  created_from: isoDay,
  created_to: isoDay,
  search: z.preprocess(blank, z.string().trim().max(200).optional()),
  include_mock: z.preprocess((v) => v === '1' || v === 'true' || v === true, z.boolean()),
}).refine((q) => !q.created_from || !q.created_to || q.created_from <= q.created_to, {
  message: 'created_from must not be after created_to', path: ['created_to'],
});

/** A whole IST day boundary as the UTC instant it falls on (for reference and tests). */
export const istDayStartUtc = (day) => new Date(Date.parse(`${day}T00:00:00Z`) - IST_OFFSET_MS);

/** The day after `day` ("YYYY-MM-DD"), as the same string form. */
export const nextDay = (day) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

// The boundary is sent as an IST wall-clock string and converted by MySQL to the session time zone, so the
// result does not depend on the time zone of the Node process or of the database server.
const IST_TO_SESSION = "CONVERT_TZ(?, '+05:30', @@session.time_zone)";

/**
 * @param {object} query  req.query
 * @returns {{ ok: true, whereSql: string, params: any[], filters: object } | { ok: false, errors: Array<{path:string, message:string}> }}
 * `whereSql` starts with "WHERE 1=1" and expects the aliases t (tickets) and u_app (applicant).
 */
export function buildAdminTicketFilter(query) {
  const parsed = schema.safeParse(query ?? {});
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
  }
  const f = parsed.data;
  const clauses = [];
  const params = [];

  if (!f.include_mock) clauses.push('t.is_mock = FALSE');
  if (f.status) { clauses.push('t.status IN (?)'); params.push(f.status); }
  for (const col of ['department', 'campus', 'priority', 'type']) {
    if (f[col]) { clauses.push(`t.${col} = ?`); params.push(f[col]); }
  }
  // Whole days in IST, as a half-open range: [from 00:00 IST, to + 1 day 00:00 IST).
  if (f.created_from) { clauses.push(`t.created_at >= ${IST_TO_SESSION}`); params.push(`${f.created_from} 00:00:00`); }
  if (f.created_to) { clauses.push(`t.created_at < ${IST_TO_SESSION}`); params.push(`${nextDay(f.created_to)} 00:00:00`); }
  if (f.search) {
    const term = `%${f.search}%`;
    const id = /^\d+$/.test(f.search) ? Number(f.search) : 0;
    clauses.push('(t.title LIKE ? OR t.description LIKE ? OR t.id = ? OR u_app.name LIKE ? OR t.location LIKE ? OR t.landmark LIKE ?)');
    params.push(term, term, id, term, term, term);
  }
  return { ok: true, whereSql: ['WHERE 1=1', ...clauses].join(' AND '), params, filters: f };
}
