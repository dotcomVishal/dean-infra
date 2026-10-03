// Weekly summary for the people who work at a desk: AE, SE and Dean (the Director gets none).
// Monday 09:00 IST (cron/emailReminders.js). One outbox row per person per ISO week, written with
// INSERT IGNORE on a unique dedupe key, so a restart or a second instance cannot send it twice.
// Empty digests are skipped. Test tickets and deleted tickets are left out.
import pool from '../config/db.js';
import { STATUS } from '../config/workflow.js';
import * as notificationModel from '../models/notificationModel.js';
import { weeklyDigestEmail } from './emailTemplates.js';

const DAY = 24 * 60 * 60 * 1000;
const DIGEST_ROLES = ['AE', 'SE', 'DEAN'];
const DESK_STATUS = { AE: [STATUS.UNASSIGNED, STATUS.PENDING_AE_APPROVAL], SE: [STATUS.PENDING_SE_APPROVAL], DEAN: [STATUS.PENDING_DEAN_APPROVAL] };
const ROLE_LABEL = { AE: 'AE', SE: 'SE', DEAN: 'Dean' };

/** ISO week of the IST calendar date of `now`, e.g. "2026-W41". */
export function isoWeekIst(now) {
  const ist = new Date(now.getTime() + 330 * 60 * 1000);
  const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
  const weekday = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - weekday + 3); // the Thursday of this week decides the year
  const year = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / DAY - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

const SCOPE_SQL = `EXISTS (SELECT 1 FROM infra_user_scopes s WHERE s.user_id = ? AND s.department = t.department
                     AND (t.campus IS NULL OR s.campus IN (t.campus, 'BOTH')))`;
const LIVE = 't.is_mock = FALSE AND t.deleted_at IS NULL';

/** What one person's digest holds, or null when it would be empty. */
export async function loadDigest(connection, user, now) {
  const statuses = DESK_STATUS[user.role];
  if (!statuses) return null;
  const mine = user.role === 'AE'
    ? `(t.current_desk_user_id = ? OR (t.status = 'UNASSIGNED' AND ${SCOPE_SQL}))`
    : 't.current_desk_user_id = ?';
  const [desk] = await connection.query(
    `SELECT t.id, t.title, COALESCE(t.status_changed_at, t.assigned_at, t.created_at) AS since
       FROM infra_tickets t
      WHERE ${LIVE} AND t.status IN (?) AND ${mine}
      ORDER BY since ASC, t.id ASC`,
    user.role === 'AE' ? [statuses, user.id, user.id] : [statuses, user.id]);
  const [[{ n: confirm }]] = await connection.query(
    `SELECT COUNT(*) AS n FROM infra_tickets t
      WHERE ${LIVE} AND t.status = ? AND t.current_desk_user_id = ? AND t.applicant_id <> ?`,
    [STATUS.WORK_COMPLETED, user.id, user.id]);
  if (desk.length === 0 && confirm === 0) return null;

  let counts = null;
  let scopeLabel = '';
  if (user.role === 'AE') {
    const count = async (where, params) => (await connection.query(
      `SELECT COUNT(*) AS n FROM infra_tickets t WHERE ${LIVE} AND ${where} AND ${SCOPE_SQL}`, [...params, user.id]))[0][0].n;
    counts = {
      withJes: await count('t.status IN (?)', [[STATUS.ASSIGNED_TO_JE, STATUS.RETURNED_TO_JE]]),
      awaitingApplicant: await count('t.status = ? AND t.current_desk_user_id = t.applicant_id', [STATUS.WORK_COMPLETED]),
      sentBack: await count('t.applicant_sent_back_at IS NOT NULL AND t.status NOT IN (?)', [[STATUS.WORK_COMPLETED, STATUS.CLOSED, STATUS.DENIED]]),
    };
    const [scopes] = await connection.query('SELECT department, campus FROM infra_user_scopes WHERE user_id = ? ORDER BY id', [user.id]);
    scopeLabel = scopes.map((s) => `${s.campus === 'BOTH' ? '' : `${s.campus[0]}${s.campus.slice(1).toLowerCase()} `}${s.department}`).join(', ');
  }
  return {
    roleLabel: ROLE_LABEL[user.role], scopeLabel, confirm, counts,
    rows: desk.map((t) => ({ id: t.id, title: t.title || 'Untitled ticket', days: Math.max(0, Math.floor((now - new Date(t.since)) / DAY)) })),
  };
}

/**
 * Queue this week's digests. Safe to run twice: the second run queues nothing.
 * @returns {Promise<number>} how many digests were queued
 */
export async function runDigest({ now = new Date() } = {}) {
  const week = isoWeekIst(now);
  const [users] = await pool.query(
    `SELECT id, name, role FROM infra_users WHERE role IN (?) AND is_active = TRUE ORDER BY id`, [DIGEST_ROLES]);
  let queued = 0;
  for (const user of users) {
    const digest = await loadDigest(pool, user, now);
    if (!digest) continue;
    const email = weeklyDigestEmail(digest);
    const added = await notificationModel.insertDigest(pool, {
      toUserId: user.id, subject: email.subject, body: email.body, dueAt: now, dedupeKey: `digest:${user.id}:${week}`,
    });
    if (added) queued += 1;
  }
  return queued;
}
