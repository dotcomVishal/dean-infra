/** notifications outbox access (plan.md §3.4). Data only: the cadence and the
 *  rules live in services/notifier.js; sending lives in cron/emailReminders.js.
 *  Every timestamp is a JS Date passed in by the caller (never NOW()), so a
 *  test can drive the whole engine with a fake clock. */

export async function insertEmail(connection, { ticketId, toUserId, audience = 'STAFF', subject, body, html = null, dueAt }) {
  const [r] = await connection.query(
    `INSERT INTO mnt_notifications (ticket_id, to_user_id, kind, audience, subject, body, body_html, next_due_at)
     VALUES (?, ?, 'EMAIL', ?, ?, ?, ?, ?)`,
    [ticketId, toUserId, audience, subject.slice(0, 255), body, html, dueAt]
  );
  return r.insertId;
}

export async function insertReminder(connection, {
  ticketId, toUserId, desk, subject, body, html = null, anchor, dueAt, stopStatuses, audience = 'STAFF',
}) {
  const [r] = await connection.query(
    `INSERT INTO mnt_notifications
       (ticket_id, to_user_id, kind, audience, desk, subject, body, body_html, anchor_at, next_due_at, stop_when_status_not_in)
     VALUES (?, ?, 'REMINDER', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [ticketId, toUserId, audience, desk, subject.slice(0, 255), body, html, anchor, dueAt, stopStatuses.join(',')]
  );
  return r.insertId;
}

/** Stops every live reminder of a ticket (it left the desk that was being nagged). */
export async function cancelReminders(connection, ticketId) {
  const [r] = await connection.query(
    `UPDATE mnt_notifications SET status = 'CANCELLED', locked_until = NULL
      WHERE ticket_id = ? AND kind = 'REMINDER' AND status = 'PENDING'`,
    [ticketId]
  );
  return r.affectedRows;
}

/**
 * Claims up to `limit` due rows. The claim is one conditional UPDATE per row
 * (a lease), so two workers can never both own a row: the loser sees
 * affectedRows = 0 and moves on. A crashed worker's lease simply expires.
 */
export async function claimDue(connection, { now, limit = 50, leaseMs = 10 * 60 * 1000 }) {
  const [candidates] = await connection.query(
    `SELECT id FROM mnt_notifications
      WHERE status = 'PENDING' AND next_due_at <= ? AND (locked_until IS NULL OR locked_until < ?)
      ORDER BY next_due_at ASC, id ASC LIMIT ?`,
    [now, now, limit]
  );
  const claimed = [];
  const lease = new Date(now.getTime() + leaseMs);
  for (const { id } of candidates) {
    const [r] = await connection.query(
      `UPDATE mnt_notifications SET locked_until = ?
        WHERE id = ? AND status = 'PENDING' AND next_due_at <= ? AND (locked_until IS NULL OR locked_until < ?)`,
      [lease, id, now, now]
    );
    if (r.affectedRows !== 1) continue;
    const [rows] = await connection.query(
      `SELECT n.*, u.email AS to_email, u.name AS to_name, u.is_active AS to_active
         FROM mnt_notifications n JOIN mnt_users u ON u.id = n.to_user_id WHERE n.id = ?`,
      [id]
    );
    claimed.push(rows[0]);
  }
  return claimed;
}

export async function markSent(connection, id, now) {
  await connection.query(
    `UPDATE mnt_notifications SET status = 'SENT', sent_at = ?, locked_until = NULL, last_error = NULL WHERE id = ?`,
    [now, id]
  );
}

export async function markCancelled(connection, id, reason = null) {
  await connection.query(
    `UPDATE mnt_notifications SET status = 'CANCELLED', locked_until = NULL, last_error = ? WHERE id = ?`,
    [reason, id]
  );
}

/** A send failed: schedule the retry, or give up (FAILED) when `giveUp`. */
export async function markFailure(connection, id, { attempts, error, nextDueAt, giveUp }) {
  await connection.query(
    `UPDATE mnt_notifications
        SET attempts = ?, last_error = ?, next_due_at = ?, locked_until = NULL,
            status = ${giveUp ? "'FAILED'" : "'PENDING'"}
      WHERE id = ?`,
    [attempts, String(error).slice(0, 500), nextDueAt, id]
  );
}

/** A reminder went out: count it and move next_due_at to the following one. */
export async function advanceReminder(connection, id, { reminderNo, nextDueAt, now }) {
  await connection.query(
    `UPDATE mnt_notifications
        SET reminder_no = ?, next_due_at = ?, sent_at = ?, attempts = 0, last_error = NULL, locked_until = NULL
      WHERE id = ?`,
    [reminderNo, nextDueAt, now, id]
  );
}

/**
 * Queues a weekly digest. `dedupeKey` is unique, so a second insert for the same
 * user and week (a restart, or a second backend instance) is silently ignored.
 * @returns {Promise<boolean>} true when a row was queued
 */
export async function insertDigest(connection, { toUserId, subject, body, html = null, dueAt, dedupeKey }) {
  const [r] = await connection.query(
    `INSERT IGNORE INTO mnt_notifications (ticket_id, to_user_id, kind, audience, subject, body, body_html, next_due_at, dedupe_key)
     VALUES (NULL, ?, 'DIGEST', 'STAFF', ?, ?, ?, ?, ?)`,
    [toUserId, subject.slice(0, 255), body, html, dueAt, dedupeKey]
  );
  return r.affectedRows === 1;
}
