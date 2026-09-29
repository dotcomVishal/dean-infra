// Desk resolution: which PERSON sits at a desk for a given ticket
// (plan.md §3.3 "Desk resolution"). Data access only -- the rules about what
// a desk may DO live in config/workflow.js.

import logger from '../utils/logger.js';
import { STATUS, deskForStatus } from '../config/workflow.js';

const PERSON = 'u.id, u.name, u.email';

/**
 * The AE for a (department, campus) scope: exact campus or a BOTH-campus AE.
 * Never the other campus's AE (plan.md Q8). A ticket with no campus (raised
 * before campus existed) matches any AE of the department.
 */
export async function resolveAeForScope(connection, { department, campus }) {
  const [rows] = await connection.query(
    `SELECT ${PERSON}
       FROM users u
       JOIN user_scopes s ON s.user_id = u.id
      WHERE u.role = 'AE' AND u.is_active = TRUE
        AND s.department = ? AND (? IS NULL OR s.campus IN (?, 'BOTH'))
      ORDER BY (s.campus = 'BOTH') ASC,
        (SELECT COUNT(*) FROM tickets t
          WHERE t.current_desk_user_id = u.id AND t.status IN ('UNASSIGNED', 'PENDING_AE_APPROVAL')) ASC,
        u.id ASC
      LIMIT 1`,
    [department, campus ?? null, campus ?? null]
  );
  return rows[0] ?? null;
}

/** Last-resort desk owner when a desk has nobody active (plan.md §3.3). */
export async function fallbackSysadmin(connection) {
  const [rows] = await connection.query(
    `SELECT id, name, email FROM users WHERE role = 'SYSADMIN' AND is_active = TRUE ORDER BY id ASC LIMIT 1`
  );
  return rows[0] ?? null;
}

/** The active person at `desk` for this ticket, or null. No fallback. */
export async function findDeskOwner(connection, ticket, desk) {
  switch (desk) {
    case 'JE': {
      if (ticket.assigned_je_id == null) return null;
      const [rows] = await connection.query(
        `SELECT ${PERSON} FROM users u WHERE u.id = ? AND u.role = 'JE' AND u.is_active = TRUE`,
        [ticket.assigned_je_id]
      );
      return rows[0] ?? null;
    }
    case 'AE':
      return resolveAeForScope(connection, { department: ticket.department, campus: ticket.campus });
    case 'SE': {
      const [rows] = await connection.query(
        `SELECT ${PERSON} FROM users u
          WHERE u.role = 'SE' AND u.is_active = TRUE
          ORDER BY EXISTS (SELECT 1 FROM user_scopes s WHERE s.user_id = u.id AND s.department = ?) DESC, u.id ASC
          LIMIT 1`,
        [ticket.department]
      );
      return rows[0] ?? null;
    }
    case 'DEAN':
    case 'DIRECTOR': {
      const [rows] = await connection.query(
        `SELECT ${PERSON} FROM users u WHERE u.role = ? AND u.is_active = TRUE ORDER BY u.id ASC LIMIT 1`,
        [desk]
      );
      return rows[0] ?? null;
    }
    default:
      return null;
  }
}

/** Is `userId` still a legitimate holder of `desk` for this ticket (right role, active, AE in scope)? */
async function holdsDesk(connection, ticket, desk, userId) {
  if (userId == null) return false;
  if (desk === 'JE' && userId !== ticket.assigned_je_id) return false;
  const campus = ticket.campus ?? null;
  const [rows] = await connection.query(
    `SELECT 1 FROM users u
      WHERE u.id = ? AND u.role = ? AND u.is_active = TRUE
        AND (? <> 'AE' OR EXISTS (
              SELECT 1 FROM user_scopes s
               WHERE s.user_id = u.id AND s.department = ? AND (? IS NULL OR s.campus IN (?, 'BOTH'))))`,
    [userId, desk, desk, ticket.department, campus, campus]
  );
  return rows.length > 0;
}

/**
 * The desk owner id to trust: the stored one while still legitimate, else a
 * fresh resolution (no fallback), else whatever is stored (A2/A3: stale
 * owners, SYSADMIN fallbacks and deactivated staff must not strand a ticket).
 */
export async function effectiveOwnerId(connection, ticket, desk) {
  const stored = ticket.current_desk_user_id ?? null;
  if (await holdsDesk(connection, ticket, desk, stored)) return stored;
  return (await findDeskOwner(connection, ticket, desk))?.id ?? stored;
}

const DESK_STATUSES = Object.values(STATUS).filter((s) => deskForStatus(s));

/** Re-point every open desk ticket whose stored owner is stale. Returns how many changed. */
export async function reconcileDeskOwners(connection) {
  const [tickets] = await connection.query(
    `SELECT id, status, department, campus, assigned_je_id, current_desk_user_id
       FROM tickets WHERE status IN (?)`,
    [DESK_STATUSES]
  );
  let fixed = 0;
  for (const t of tickets) {
    const id = await effectiveOwnerId(connection, t, deskForStatus(t.status));
    if (id !== t.current_desk_user_id) {
      await connection.query('UPDATE tickets SET current_desk_user_id = ? WHERE id = ?', [id, t.id]);
      fixed += 1;
    }
  }
  return fixed;
}

/** Owner with the SYSADMIN fallback + an alert in the log when it kicks in. */
export async function resolveDeskOwner(connection, ticket, desk) {
  const owner = await findDeskOwner(connection, ticket, desk);
  if (owner) return owner;
  const admin = await fallbackSysadmin(connection);
  if (admin) logger.error('ALERT: no active desk owner; falling back to SYSADMIN', { desk, ticketId: ticket.id, fallbackUserId: admin.id });
  return admin;
}

/** { JE: id|null, AE: id|null, ... } for the given desks (no fallback). */
export async function findOwners(connection, ticket, desks) {
  const out = {};
  for (const d of desks) out[d] = (await findDeskOwner(connection, ticket, d))?.id ?? null;
  return out;
}

/** An active JE whose scope covers this department and the ticket's campus (null campus = any). */
export async function getEligibleJe(connection, jeId, department, campus = null) {
  const [rows] = await connection.query(
    `SELECT ${PERSON} FROM users u
      WHERE u.id = ? AND u.role = 'JE' AND u.is_active = TRUE
        AND EXISTS (SELECT 1 FROM user_scopes s WHERE s.user_id = u.id AND s.department = ?
                    AND (? IS NULL OR s.campus IN (?, 'BOTH')))`,
    [jeId, department, campus, campus]
  );
  return rows[0] ?? null;
}
