// One filter for the Sysadmin ticket list and its CSV export, so the file always equals the filtered list.
// Pure: query in, { whereSql, params } out. Every value is validated, then bound (never interpolated).
import { z } from 'zod';
import { STATUS } from '../config/workflow.js';

export class FilterError extends Error {
  constructor(issues) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join('; '));
    this.name = 'FilterError';
    this.issues = issues;
  }
}

const ALL = (v) => (v === undefined || v === '' || v === 'ALL' ? undefined : v);
const flag = z.preprocess((v) => (v === '1' || v === 'true' || v === true ? true : v === undefined || v === '' || v === '0' || v === 'false' ? false : v), z.boolean());
const oneOf = (values, label) => z.preprocess(ALL, z.enum(values, { message: `${label} must be one of ${values.join(', ')}` }).optional());

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const day = (label) => z.preprocess(ALL, z.string().refine((s) => DATE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s, {
  message: `${label} must be a date (YYYY-MM-DD)`,
}).optional());

const statuses = z.preprocess(
  (v) => (ALL(v) === undefined ? undefined : String(v).split(',').map((s) => s.trim()).filter(Boolean)),
  z.array(z.enum(Object.values(STATUS), { message: 'status holds an unknown status' })).max(20).optional());

export const ticketFilterSchema = z.object({
  search: z.preprocess(ALL, z.string().trim().max(100).optional()),
  status: statuses,
  campus: oneOf(['NORTH', 'SOUTH'], 'campus'),
  department: oneOf(['Civil', 'Electrical', 'Horticulture'], 'department'),
  priority: oneOf(['LOW', 'NORMAL', 'URGENT'], 'priority'),
  type: oneOf(['recurring', 'non-recurring'], 'type'),
  from: day('from'),
  to: day('to'),
  include_mock: flag,
  include_deleted: flag,
  awaiting_confirmation: flag,
  sent_back: flag,
}).refine((q) => !(q.from && q.to) || q.from <= q.to, { path: ['to'], message: 'to must be on or after from' });

// Dates are IST calendar days; stored times are UTC. 00:00 IST = 18:30 UTC the day before.
const IST_OFFSET_MS = 330 * 60 * 1000;
const istDayStartUtc = (ymd) => new Date(Date.parse(`${ymd}T00:00:00Z`) - IST_OFFSET_MS);

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * @param {object} query  req.query
 * @returns {{ whereSql: string, params: any[] }}  a condition (no WHERE keyword) over alias `t` (tickets) and
 *   `u_app` (the applicant), always non-empty
 * @throws {FilterError}
 */
export function buildTicketFilter(query = {}) {
  const parsed = ticketFilterSchema.safeParse(query);
  if (!parsed.success) {
    throw new FilterError(parsed.error.issues.map((i) => ({ path: i.path.join('.') || 'query', message: i.message })));
  }
  const q = parsed.data;
  const where = ['1 = 1'];
  const params = [];

  if (!q.include_mock) where.push('t.is_mock = FALSE');
  if (!q.include_deleted) where.push('t.deleted_at IS NULL');
  if (q.status?.length) { where.push('t.status IN (?)'); params.push(q.status); }
  if (q.campus) { where.push('t.campus = ?'); params.push(q.campus); }
  if (q.department) { where.push('t.department = ?'); params.push(q.department); }
  if (q.priority) { where.push('t.priority = ?'); params.push(q.priority); }
  if (q.type) { where.push('t.type = ?'); params.push(q.type); }
  if (q.from) { where.push('t.created_at >= ?'); params.push(istDayStartUtc(q.from)); }
  if (q.to) { where.push('t.created_at < ?'); params.push(new Date(istDayStartUtc(q.to).getTime() + 24 * 3600 * 1000)); }
  if (q.awaiting_confirmation) { where.push('t.status = ?'); params.push(STATUS.WORK_COMPLETED); }
  if (q.sent_back) {
    where.push('t.applicant_sent_back_at IS NOT NULL AND t.status NOT IN (?)');
    params.push([STATUS.WORK_COMPLETED, STATUS.CLOSED, STATUS.DENIED]);
  }
  if (q.search) {
    const term = `%${escapeLike(q.search)}%`;
    const asId = /^(?:#?TKT-?)?0*(\d{1,9})$/i.exec(q.search);
    where.push('(t.title LIKE ? OR t.description LIKE ? OR u_app.name LIKE ? OR t.landmark LIKE ?' + (asId ? ' OR t.id = ?' : '') + ')');
    params.push(term, term, term, term);
    if (asId) params.push(Number(asId[1]));
  }
  return { whereSql: where.join(' AND '), params };
}

