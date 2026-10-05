// ============================================================
//  WEEKLY DIGEST (Master-plan Phase 4)
//
//  Monday 09:00 Asia/Kolkata: one mail per active AE, SE, Dean, Clerical and
//  Accountant, counts first, then the oldest items. Skipped when there is
//  nothing to report. Duplicate-safe: the outbox row carries the unique key
//  "digest:<ISO week>:<user id>" and is written with INSERT IGNORE.
//
//  buildDigest() is pure (unit tested); loadDigestData() reads the counts.
// ============================================================
import cron from 'node-cron';
import pool from '../config/db.js';
import logger, { errorFields } from '../utils/logger.js';
import { JE_STAGE, STATUS } from '../config/workflow.js';
import * as notificationModel from '../models/notificationModel.js';
import { DIGEST_ROLES } from '../services/emailPolicy.js';
import { DAY, OVERDUE_JE_HOURS, istParts, isoWeekKey, buildDigest } from '../services/digestBuilder.js';

export { isoWeekKey, weekRangeLabel, buildDigest } from '../services/digestBuilder.js';
import { kickOutbox } from './emailReminders.js';

// ---- loaders --------------------------------------------------------------------------------
const MS_HOUR = 60 * 60 * 1000;
const SINCE_EXPR = 'COALESCE(t.status_changed_at, t.assigned_at, t.created_at)';
const daysSince = (date, now) => Math.max(0, Math.floor((now - new Date(date)) / DAY));

// COLLATE: tickets and user_scopes were created with different default collations on some
// servers; comparing the columns bare raises ER_CANT_AGGREGATE_2COLLATIONS (same guard as deskController).
const AE_SCOPE = `(t.current_desk_user_id = ? OR EXISTS (
  SELECT 1 FROM user_scopes s
   WHERE s.user_id = ? AND s.department = t.department COLLATE utf8mb4_unicode_ci
     AND (t.campus IS NULL OR s.campus IN (t.campus COLLATE utf8mb4_unicode_ci, 'BOTH'))))`;

async function weekCount(connection, sql, params) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.n);
}

/** Reads what one user's digest reports. Returns the input of buildDigest. */
export async function loadDigestData(connection, user, now = new Date()) {
  const since = new Date(now.getTime() - 7 * DAY);
  const rows = async (where, params, label, limit = 50) => {
    const [r] = await connection.query(
      `SELECT t.id, ${SINCE_EXPR} AS since FROM tickets t
        WHERE t.is_mock = FALSE AND ${where} ORDER BY since ASC LIMIT ?`, [...params, limit]);
    return r.map((x) => ({ id: x.id, days: daysSince(x.since, now), label }));
  };
  const total = async (where, params) => weekCount(connection,
    `SELECT COUNT(*) AS n FROM tickets t WHERE t.is_mock = FALSE AND ${where}`, params);

  switch (user.role) {
    case 'AE': {
      const unassignedW = `t.status = ? AND ${AE_SCOPE}`;
      const unassignedP = [STATUS.UNASSIGNED, user.id, user.id];
      const reviewW = 't.status = ? AND t.current_desk_user_id = ?';
      const reviewP = [STATUS.PENDING_AE_APPROVAL, user.id];
      const lateW = `t.status IN (?) AND ${AE_SCOPE} AND ${SINCE_EXPR} < ?`;
      const lateP = [JE_STAGE, user.id, user.id, new Date(now.getTime() - OVERDUE_JE_HOURS * MS_HOUR)];
      const resolvedW = `t.resolved_from_status IS NOT NULL AND t.resolved_from_status NOT IN (?) AND t.resolved_at >= ? AND ${AE_SCOPE}`;
      let resolvedElsewhere = 0;
      try { // column arrives with migration 012 (tender lifecycle)
        resolvedElsewhere = await total(resolvedW, [[STATUS.WORK_IN_PROGRESS, STATUS.WORK_COMPLETED], since, user.id, user.id]);
      } catch (err) { if (err.code !== 'ER_BAD_FIELD_ERROR') throw err; }
      return {
        counts: [
          ['Awaiting your review', await total(reviewW, reviewP)],
          ['Unassigned in your scope', await total(unassignedW, unassignedP)],
          [`JE tickets pending over ${OVERDUE_JE_HOURS} hours`, await total(lateW, lateP)],
          ['Resolved by the JE outside the tender flow this week', resolvedElsewhere],
        ],
        oldest: [
          ...await rows(reviewW, reviewP, 'awaiting your review'),
          ...await rows(unassignedW, unassignedP, 'unassigned'),
          ...await rows(lateW, lateP, 'pending with the JE'),
        ],
      };
    }
    case 'SE':
    case 'DEAN': {
      const status = user.role === 'SE' ? STATUS.PENDING_SE_APPROVAL : STATUS.PENDING_DEAN_APPROVAL;
      const w = 't.status = ? AND t.current_desk_user_id = ?';
      const decided = await weekCount(connection,
        `SELECT COUNT(DISTINCT a.ticket_id) AS n FROM audit_logs a JOIN tickets t ON t.id = a.ticket_id
          WHERE t.is_mock = FALSE AND a.user_id = ? AND a.created_at >= ?
            AND a.action IN ('FORWARDED','APPROVED','REJECTED','CHANGES_REQUESTED')`, [user.id, since]);
      return {
        counts: [['Awaiting your decision', await total(w, [status, user.id])], ['Decided by you this week', decided]],
        oldest: await rows(w, [status, user.id], 'awaiting your decision'),
      };
    }
    case 'CLERICAL': {
      const n = (action) => weekCount(connection,
        `SELECT COUNT(DISTINCT a.ticket_id) AS n FROM audit_logs a JOIN tickets t ON t.id = a.ticket_id
          WHERE t.is_mock = FALSE AND a.action = ? AND a.created_at >= ?`, [action, since]);
      return {
        counts: [
          ['Tenders published this week', await n('TENDER_PUBLISHED')],
          ['Tenders awarded this week', await n('WORK_AWARDED')],
          ['Tenders cancelled this week', await n('TENDER_CANCELLED')],
        ],
        oldest: [],
      };
    }
    case 'ACCOUNTANT': {
      const awarded = await weekCount(connection,
        `SELECT COUNT(DISTINCT a.ticket_id) AS n FROM audit_logs a JOIN tickets t ON t.id = a.ticket_id
          WHERE t.is_mock = FALSE AND a.action = 'WORK_AWARDED' AND a.created_at >= ?`, [since]);
      const pendingBills = await weekCount(connection,
        `SELECT COUNT(*) AS n FROM bills b JOIN tickets t ON t.id = b.ticket_id
          WHERE t.is_mock = FALSE AND b.payment_status = 'PENDING'`, []);
      return { counts: [['Tickets awarded this week', awarded], ['Bills pending', pendingBills]], oldest: [] };
    }
    default:
      return { counts: [], oldest: [] };
  }
}

/** Mail text for one user, or null when empty. Used by the Sysadmin preview. */
export async function previewDigestFor(connection, user, now = new Date()) {
  return buildDigest(user.role, await loadDigestData(connection, user, now), now);
}

/**
 * Queues this week's digest for every active user of a digest role. Safe to run
 * twice in one week: the unique dedupe key makes the second pass a no-op.
 * @returns {Promise<{queued:number, skipped:number}>}
 */
export async function queueWeeklyDigests({ now = new Date(), connection = pool } = {}) {
  const week = isoWeekKey(now);
  const [users] = await connection.query(
    `SELECT id, name, email, role FROM users WHERE is_active = TRUE AND role IN (?) AND email NOT LIKE '%.invalid'`,
    [DIGEST_ROLES]);
  const out = { queued: 0, skipped: 0 };
  for (const user of users) {
    try {
      const mail = await previewDigestFor(connection, user, now);
      if (!mail) { out.skipped += 1; continue; }
      const queued = await notificationModel.insertDigest(connection, {
        toUserId: user.id, subject: mail.subject, body: mail.body, dueAt: now, dedupeKey: `digest:${week}:${user.id}`,
      });
      if (queued) out.queued += 1;
    } catch (err) {
      logger.error('weekly digest failed for a user', { userId: user.id, ...errorFields(err) });
    }
  }
  return out;
}

let started = false;

/** Schedules Monday 09:00 IST. A restart later on Monday catches up; the dedupe key prevents a second mail. */
export function startWeeklyDigest() {
  if (started || process.env.DISABLE_WEEKLY_DIGEST === 'true') return;
  started = true;
  const run = async () => {
    try {
      const out = await queueWeeklyDigests();
      logger.info('weekly digest queued', out);
      if (out.queued) kickOutbox();
    } catch (err) {
      logger.error('weekly digest error', errorFields(err));
    }
  };
  cron.schedule('0 9 * * 1', run, { timezone: 'Asia/Kolkata' });
  const p = istParts(new Date());
  if (p.dow === 1 && p.hour >= 9) run();
}
