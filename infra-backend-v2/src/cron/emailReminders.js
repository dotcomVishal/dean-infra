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
//  leaves the stage being nagged. Only the JE is reminded (services/emailPolicy.js).
//  Each reminder sent writes REMINDER_SENT to the audit log.
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
import { reminderDueAt } from '../services/notifier.js';
import { build } from '../services/emailTemplates.js';
import { remindersAllowed } from '../services/emailPolicy.js';
import { startWeeklyDigest } from './weeklyDigest.js';

export const MAX_ATTEMPTS = 5;
const HOUR = 60 * 60 * 1000;
const backoffMs = (attempts) => Math.min(5 * 60 * 1000 * 2 ** (attempts - 1), 6 * HOUR); // 5, 10, 20, 40 min...

async function loadTicket(connection, ticketId) {
  const [rows] = await connection.query(
    `SELECT id, title, status, department, campus, applicant_id, assigned_je_id, current_desk_user_id
       FROM mnt_tickets WHERE id = ?`, [ticketId]);
  return rows[0] ?? null;
}

/** Is this reminder row still about the person and stage it was created for? */
function reminderStillApplies(row, ticket) {
  if (!ticket) return false;
  const stop = (row.stop_when_status_not_in ?? '').split(',').filter(Boolean);
  if (!stop.includes(ticket.status)) return false;
  // Only the JE is reminded; a row for any other desk predates the policy.
  return row.desk === 'JE' && ticket.assigned_je_id === row.to_user_id;
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
  let html = row.body_html ?? undefined; // rows queued before migration 002 have no HTML part
  const number = row.reminder_no + 1;
  let ticket = null;

  if (isReminder) {
    ticket = await loadTicket(pool, row.ticket_id);
    if (!reminderStillApplies(row, ticket) || !row.to_active || !remindersAllowed('JE')) {
      await notificationModel.markCancelled(pool, row.id, 'stage left or recipient changed');
      return 'cancelled';
    }
    if (number > 1) {
      ({ subject, body, html } = build('je/reminder', {
        id: ticket.id, name: row.to_name, title: ticket.title, number,
        hours: Math.floor((now - new Date(row.anchor_at)) / HOUR),
      }));
    }
  } else if (!row.to_active) {
    await notificationModel.markFailure(pool, row.id, {
      attempts: row.attempts + 1, error: 'recipient inactive', nextDueAt: now, giveUp: true });
    return 'failed';
  }

  try {
    await send({ to: row.to_email, subject, text: body, html });
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
    await notificationModel.advanceReminder(conn, row.id, {
      reminderNo: number, nextDueAt: reminderDueAt(new Date(row.anchor_at), number + 1), now,
    });
    await insertAudit(conn, {
      ticketId: row.ticket_id, userId: row.to_user_id, action: 'REMINDER_SENT',
      remarks: `Reminder ${number} sent to ${row.desk}`,
      visibility: 'INTERNAL',
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    // The ticket was deleted between the send and the bookkeeping: nothing is wrong, nothing to retry.
    if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_NO_REFERENCED_ROW') {
      logger.info('reminder bookkeeping skipped: the ticket no longer exists', { notificationId: row.id, ticketId: row.ticket_id });
      return 'cancelled';
    }
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

/** Called by server.js once the app is listening. Disabled with DISABLE_EMAIL_WORKER=true. */
export function startEmailWorker() {
  if (started || process.env.DISABLE_EMAIL_WORKER === 'true') return;
  started = true;
  cron.schedule('* * * * *', tick);
  startWeeklyDigest();
  tick();
}

/** Controllers call this after commit so the instant notice goes out now, not at the next minute. No-op unless the worker is running. */
export function kickOutbox() {
  if (started) setImmediate(tick);
}
