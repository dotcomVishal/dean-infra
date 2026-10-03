// ============================================================
//  OUTBOX WORKER (plan.md §3.4, §4 Phase 5)
//
//  Every minute: claim due rows from `notifications` (a per-row lease, so two
//  backend instances never send the same row), send them with nodemailer, and
//  retry failures with exponential backoff. A restart loses nothing: rows are
//  in the database, and a crashed worker's lease just expires.
//
//  Reminder rows (kind = REMINDER) stay PENDING and move next_due_at forward
//  after each send (see services/notifier.js for the cadence) until the ticket
//  leaves the stage being nagged. Only the JE and the confirmer of a resolved
//  ticket are ever nagged. Each reminder sent writes REMINDER_SENT to the audit log.
//
//  At-least-once: a crash between "SMTP accepted" and "row updated" re-sends
//  that one mail after the lease expires. Duplicates are possible, losses are not.
// ============================================================
import cron from 'node-cron';
import pool from '../config/db.js';
import logger, { errorFields } from '../utils/logger.js';
import { deliverEmail, isPlaceholderEmail } from '../utils/mailer.js';
import * as notificationModel from '../models/notificationModel.js';
import { insertAudit } from '../models/auditModel.js';
import { reminderDueAt, CONFIRMER_MAX_MAILS, notifyAutoClosed } from '../services/notifier.js';
import { runDigest } from '../services/digest.js';
import { reminderEmail, resolvedConfirmEmail } from '../services/emailTemplates.js';
import { AUTO_CLOSE_DAYS, STATUS } from '../config/workflow.js';

export const MAX_ATTEMPTS = 5;
const HOUR = 60 * 60 * 1000;
const backoffMs = (attempts) => Math.min(5 * 60 * 1000 * 2 ** (attempts - 1), 6 * HOUR); // 5, 10, 20, 40 min...

async function loadTicket(connection, ticketId) {
  const [rows] = await connection.query(
    `SELECT id, title, status, department, campus, applicant_id, assigned_je_id, current_desk_user_id,
            resolved_at, resolution_kind, assigned_ae_id, deleted_at
       FROM infra_tickets WHERE id = ?`, [ticketId]);
  return rows[0] ?? null;
}

/** Is this reminder row still about the person and stage it was created for? */
function reminderStillApplies(row, ticket) {
  if (!ticket || ticket.deleted_at) return false; // a deleted ticket nags nobody
  const stop = (row.stop_when_status_not_in ?? '').split(',').filter(Boolean);
  if (!stop.includes(ticket.status)) return false;
  // APPLICANT series = the confirmer: stored on the ticket at resolve time (the AE when the JE raised it).
  const holder = row.desk === 'JE' ? ticket.assigned_je_id : ticket.current_desk_user_id;
  return holder === row.to_user_id;
}

async function sendOne(row, { now, send }) {
  // A placeholder Dean/Director has no real mailbox. Cancel instead of retrying until the Sysadmin sets the real e-mail.
  if (isPlaceholderEmail(row.to_email)) {
    await notificationModel.markCancelled(pool, row.id, 'placeholder address');
    return 'cancelled';
  }
  const isReminder = row.kind === 'REMINDER';
  let subject = row.subject;
  let body = row.body;
  const number = row.reminder_no + 1;
  let ticket = null;

  if (isReminder) {
    ticket = await loadTicket(pool, row.ticket_id);
    if (!reminderStillApplies(row, ticket) || !row.to_active) {
      await notificationModel.markCancelled(pool, row.id, 'stage left or recipient changed');
      return 'cancelled';
    }
    if (number > 1 && row.desk === 'APPLICANT') {
      const resolvedAt = new Date(ticket.resolved_at);
      ({ subject, body } = resolvedConfirmEmail({
        ticketId: ticket.id, title: ticket.title, kind: ticket.resolution_kind, number,
        autoCloseOn: new Date(resolvedAt.getTime() + AUTO_CLOSE_DAYS * 24 * HOUR),
        forAe: ticket.applicant_id !== row.to_user_id,
      }));
    } else if (number > 1) {
      ({ subject, body } = reminderEmail({
        ticketId: ticket.id, title: ticket.title, number,
        hoursPending: Math.floor((now - new Date(row.anchor_at)) / HOUR), since: new Date(row.anchor_at),
      }));
    }
  } else if (!row.to_active) {
    await notificationModel.markFailure(pool, row.id, {
      attempts: row.attempts + 1, error: 'recipient inactive', nextDueAt: now, giveUp: true });
    return 'failed';
  }

  try {
    await send({ to: row.to_email, subject, text: body });
  } catch (err) {
    const attempts = row.attempts + 1;
    const giveUp = attempts >= MAX_ATTEMPTS;
    await notificationModel.markFailure(pool, row.id, {
      attempts, error: err.message, giveUp, nextDueAt: new Date(now.getTime() + backoffMs(attempts)),
    });
    if (giveUp) logger.error('ALERT: notification gave up', { notificationId: row.id, attempts, reason: err.message });
    return giveUp ? 'failed' : 'retry';
  }

  if (!isReminder) {
    await notificationModel.markSent(pool, row.id, now);
    return 'sent';
  }
  // Counting the reminder, scheduling the next one and the audit line are one unit.
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (row.desk === 'APPLICANT' && number >= CONFIRMER_MAX_MAILS) {
      // Bounded: the resolve mail plus a daily reminder, then the auto-close mail takes over.
      await notificationModel.markSent(conn, row.id, now);
    } else {
      await notificationModel.advanceReminder(conn, row.id, {
        reminderNo: number, nextDueAt: reminderDueAt(new Date(row.anchor_at), number + 1, row.desk), now,
      });
    }
    await insertAudit(conn, {
      ticketId: row.ticket_id, userId: row.to_user_id, action: 'REMINDER_SENT',
      remarks: `Reminder ${number} sent to ${row.desk}`,
      visibility: 'INTERNAL',
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return 'sent';
}

/**
 * One worker pass. `now` and `send` are injectable so tests can use a fake
 * clock and a fake mailer.
 * @returns {Promise<{sent:number, retry:number, failed:number, cancelled:number}>}
 */
export async function processDueNotifications({ now = new Date(), send = deliverEmail, limit = 50 } = {}) {
  const tally = { sent: 0, retry: 0, failed: 0, cancelled: 0 };
  const rows = await notificationModel.claimDue(pool, { now, limit });
  for (const row of rows) {
    try {
      tally[await sendOne({ ...row, to_active: !!row.to_active }, { now, send })]++;
    } catch (err) {
      // Bookkeeping failed after a possible send: the lease expires and the row is retried.
      logger.error('notification bookkeeping failed', { notificationId: row.id, ...errorFields(err) });
    }
  }
  return tally;
}

// ---- auto-close -----------------------------------------------------------------------
/**
 * A resolved ticket nobody answered within AUTO_CLOSE_DAYS closes itself. One compare-and-swap update per
 * ticket, so a confirmer answering at the same moment wins and nothing is closed twice. Test tickets are
 * excluded. Each closure is a timeline entry (recorded against the confirmer, like REMINDER_SENT), stops the
 * reminder series and queues the "closed automatically" mail. `now` is injectable for a fake clock.
 * @returns {Promise<number[]>} ids of the tickets closed
 */
export async function autoCloseResolved({ now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - AUTO_CLOSE_DAYS * 24 * HOUR);
  const [due] = await pool.query(
    `SELECT id, current_desk_user_id, resolved_by, resolved_at FROM infra_tickets
      WHERE status = ? AND resolved_at <= ? AND is_mock = FALSE AND deleted_at IS NULL ORDER BY resolved_at ASC LIMIT 200`,
    [STATUS.WORK_COMPLETED, cutoff]);
  const closed = [];
  for (const t of due) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [r] = await conn.query(
        `UPDATE infra_tickets
            SET status = ?, status_changed_at = ?, closed_at = ?, current_desk_user_id = NULL, open_change_request_id = NULL
          WHERE id = ? AND status = ? AND resolved_at <= ? AND deleted_at IS NULL`,
        [STATUS.CLOSED, now, now, t.id, STATUS.WORK_COMPLETED, cutoff]);
      if (r.affectedRows !== 1) { await conn.rollback(); continue; }
      const actor = t.current_desk_user_id ?? t.resolved_by;
      if (actor != null) {
        await insertAudit(conn, {
          ticketId: t.id, userId: actor, action: 'AUTO_CLOSED',
          remarks: `Closed automatically: no answer within ${AUTO_CLOSE_DAYS} days of being resolved`,
          fromStatus: STATUS.WORK_COMPLETED, toStatus: STATUS.CLOSED,
        });
      }
      await notifyAutoClosed(conn, { ticketId: t.id, confirmerId: t.current_desk_user_id, resolvedAt: t.resolved_at, now });
      await conn.commit();
      closed.push(t.id);
    } catch (err) {
      await conn.rollback();
      logger.error('auto-close failed', { ticketId: t.id, ...errorFields(err) });
    } finally {
      conn.release();
    }
  }
  return closed;
}

// ---- lifecycle ------------------------------------------------------------------------
let started = false;
let running = false;

async function tick() {
  if (running) return; // never overlap passes in this process
  running = true;
  try {
    const t = await processDueNotifications();
    if (t.sent || t.retry || t.failed || t.cancelled) logger.info('outbox pass', t);
  } catch (err) {
    logger.error('outbox worker error', errorFields(err));
  } finally {
    running = false;
  }
}

async function digestTick() {
  try {
    const queued = await runDigest();
    if (queued) { logger.info('weekly digests queued', { count: queued }); kickOutbox(); }
  } catch (err) {
    logger.error('weekly digest error', errorFields(err));
  }
}

async function autoCloseTick() {
  try {
    const closed = await autoCloseResolved();
    if (closed.length) logger.info('auto-closed resolved tickets', { count: closed.length, ids: closed });
  } catch (err) {
    logger.error('auto-close pass error', errorFields(err));
  }
}

/** Called by server.js once the app is listening. Disabled with DISABLE_EMAIL_WORKER=true. */
export function startEmailWorker() {
  if (started || process.env.DISABLE_EMAIL_WORKER === 'true') return;
  started = true;
  cron.schedule('* * * * *', tick);
  cron.schedule('5 * * * *', autoCloseTick);
  // Monday 09:00 IST. The unique dedupe key makes a restart or a second instance harmless.
  cron.schedule('0 9 * * 1', digestTick, { timezone: 'Asia/Kolkata' });
  tick();
  autoCloseTick();
}

/** Controllers call this after commit so the instant notice goes out now, not at the next minute. No-op unless the worker is running. */
export function kickOutbox() {
  if (started) setImmediate(tick);
}
