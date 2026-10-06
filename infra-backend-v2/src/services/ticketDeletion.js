// Sysadmin ticket deletion (Master-plan Phase 7).
//
// The database side is one transaction: tombstone, explicit child deletes, the ticket, and a check
// that nothing is left. The files are moved to uploads/trash AFTER the commit (one rename on the same
// volume) and purged after 30 days. A failed rename is logged as an alert: the rows are gone, so the
// folder is unreachable through the API.
import fs from 'fs';
import path from 'path';
import { TICKETS_DIR, TRASH_DIR } from '../config/paths.js';
import { LATEST_REPORT, AWARDED_TENDER } from '../models/amountsModel.js';
import logger, { errorFields } from '../utils/logger.js';

// Order matters: reports point at messages, messages point at audit rows.
export const CHILD_TABLES = Object.freeze([
  'bills', 'tenders', 'attachments', 'notifications', 'reports', 'ticket_messages', 'audit_logs',
]);

export const TRASH_KEEP_DAYS = 30;

/** Counts of everything a delete would remove, and whether money is involved. */
export async function deletionPreview(connection, ticketId) {
  const counts = {};
  for (const table of CHILD_TABLES) {
    const [[row]] = await connection.query(`SELECT COUNT(*) AS n FROM mnt_${table} WHERE ticket_id = ?`, [ticketId]);
    counts[table] = Number(row.n);
  }
  const [[award]] = await connection.query(
    "SELECT COUNT(*) AS n FROM mnt_tenders WHERE ticket_id = ? AND status = 'AWARDED'", [ticketId]);
  return { counts, has_bills: counts.bills > 0, has_award: Number(award.n) > 0, financial: counts.bills > 0 || Number(award.n) > 0 };
}

/** What the tombstone keeps: the ticket row, child counts, money, file names. */
export async function buildSnapshot(connection, ticket) {
  const preview = await deletionPreview(connection, ticket.id);
  const [[amounts]] = await connection.query(
    `SELECT r.estimated_amount, aw.work_order_value AS award_amount
       FROM mnt_tickets t
       LEFT JOIN ${LATEST_REPORT} r ON r.ticket_id = t.id
       LEFT JOIN ${AWARDED_TENDER} aw ON aw.ticket_id = t.id
      WHERE t.id = ?`, [ticket.id]);
  const [[billTotals]] = await connection.query(
    'SELECT COALESCE(SUM(gross_amount), 0) AS gross, COALESCE(SUM(net_amount), 0) AS net FROM mnt_bills WHERE ticket_id = ?', [ticket.id]);
  const [files] = await connection.query('SELECT file_url FROM mnt_attachments WHERE ticket_id = ? ORDER BY id', [ticket.id]);
  return {
    ticket,
    row_counts: preview.counts,
    estimate: amounts?.estimated_amount ?? null,
    award_amount: amounts?.award_amount ?? null,
    bill_totals: { gross: Number(billTotals.gross), net: Number(billTotals.net) },
    file_names: files.map((f) => path.basename(String(f.file_url))),
  };
}

/**
 * Deletes every child row, then the ticket, then proves nothing is left. Explicit deletes make the
 * operation correct even where a cascade rule is missing. Throws (so the caller rolls back) when a row remains.
 */
export async function deleteTicketCascade(connection, ticketId) {
  for (const table of CHILD_TABLES) {
    await connection.query(`DELETE FROM mnt_${table} WHERE ticket_id = ?`, [ticketId]);
  }
  await connection.query('DELETE FROM mnt_tickets WHERE id = ?', [ticketId]);
  for (const table of CHILD_TABLES) {
    const [[row]] = await connection.query(`SELECT COUNT(*) AS n FROM mnt_${table} WHERE ticket_id = ?`, [ticketId]);
    if (Number(row.n) !== 0) throw new Error(`deleteTicketCascade: ${row.n} row(s) remain in ${table} for ticket ${ticketId}`);
  }
  const [[left]] = await connection.query('SELECT COUNT(*) AS n FROM mnt_tickets WHERE id = ?', [ticketId]);
  if (Number(left.n) !== 0) throw new Error(`deleteTicketCascade: ticket ${ticketId} still exists`);
}

/** Moves uploads/tickets/<id> to uploads/trash/<id>-<timestamp>. Never throws: the database is already consistent. */
export function trashTicketFiles(ticketId, now = Date.now()) {
  const from = path.join(TICKETS_DIR, String(ticketId));
  try {
    if (!fs.existsSync(from)) return null;
    fs.mkdirSync(TRASH_DIR, { recursive: true });
    const to = path.join(TRASH_DIR, `${ticketId}-${now}`);
    fs.renameSync(from, to);
    return to;
  } catch (err) {
    logger.error('ALERT: ticket files were not moved to trash', { ticketId, ...errorFields(err) });
    return null;
  }
}

/** Removes trash folders older than `keepDays`. Returns how many were purged. */
export function purgeTrash({ keepDays = TRASH_KEEP_DAYS, now = Date.now() } = {}) {
  let purged = 0;
  let names = [];
  try { names = fs.readdirSync(TRASH_DIR); } catch (err) { if (err.code === 'ENOENT') return 0; throw err; }
  for (const name of names) {
    const dir = path.join(TRASH_DIR, name);
    try {
      // The folder name ends in the moment it was trashed.
      const stamp = Number(/-(\d{10,})$/.exec(name)?.[1]) || fs.statSync(dir).mtimeMs;
      if (now - stamp > keepDays * 24 * 60 * 60 * 1000) {
        fs.rmSync(dir, { recursive: true, force: true });
        purged += 1;
      }
    } catch (err) {
      logger.warn('trash purge: could not remove a folder', { name, code: err.code });
    }
  }
  return purged;
}
