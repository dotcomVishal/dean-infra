// Desk resolution: which PERSON sits at a desk for a given ticket
// (plan.md §3.3 "Desk resolution"). Data access only -- the rules about what
// a desk may DO live in config/workflow.js.

import logger from '../utils/logger.js';
import { findDemoUser } from '../config/demo.js';
import { STATUS, deskForStatus, AE_STAGE } from '../config/workflow.js';

const PERSON = 'u.id, u.name, u.email, u.role';

/**
 * The AE for a (department, campus) scope: exact campus or a BOTH-campus AE.
 * Never the other campus's AE (plan.md Q8). A ticket with no campus (raised
 * before campus existed) matches any AE of the department.
 */
export async function resolveAeForScope(connection, { department, campus }) {
  const [rows] = await connection.query(
    `SELECT ${PERSON}
       FROM mnt_users u
       JOIN mnt_user_scopes s ON s.user_id = u.id
      WHERE u.role = 'AE' AND u.is_active = TRUE AND u.is_demo = FALSE
        AND s.department = ? AND (? IS NULL OR s.campus IN (?, 'BOTH'))
      ORDER BY (s.campus = 'BOTH') ASC,
        (SELECT COUNT(*) FROM mnt_tickets t
          WHERE t.current_desk_user_id = u.id AND t.status IN (?, ?)) ASC,
        u.id ASC
      LIMIT 1`,
    [department, campus ?? null, campus ?? null, ...AE_STAGE]
  );
  return rows[0] ?? null;
}

/** Last-resort desk owner when a desk has nobody active (plan.md §3.3). */
export async function fallbackSysadmin(connection) {
  const [rows] = await connection.query(
    `SELECT id, name, email, role FROM mnt_users WHERE role = 'SYSADMIN' AND is_active = TRUE AND is_demo = FALSE ORDER BY id ASC LIMIT 1`
  );
  return rows[0] ?? null;
}

// A pinned holder (tickets.assigned_ae_id / assigned_se_id) wins while still an active user of that role.
async function findPinned(connection, id, role) {
  if (id == null) return null;
  const [rows] = await connection.query(
    `SELECT ${PERSON} FROM mnt_users u WHERE u.id = ? AND u.role = ? AND u.is_active = TRUE`, [id, role]);
  return rows[0] ?? null;
}

// Mock tickets (Sysadmin test tickets) have one person at every desk: the creator.
async function findMockOwner(connection, ticket) {
  const [rows] = await connection.query(
    `SELECT ${PERSON} FROM mnt_users u WHERE u.id = ? AND u.is_active = TRUE`, [ticket.applicant_id]);
  return rows[0] ?? null;
}

/** The active person at `desk` for this ticket, or null. No fallback. */
export async function findDeskOwner(connection, ticket, desk) {
  if (ticket.is_mock && ticket.applicant_id != null) {
    // Demo tickets: each desk is held by the demo account of that role. The row may come without is_demo.
    let demo = ticket.is_demo;
    if (demo === undefined) {
      const [rows] = await connection.query('SELECT is_demo FROM mnt_tickets WHERE id = ?', [ticket.id]);
      demo = !!rows[0]?.is_demo;
    }
    return demo ? findDemoUser(connection, desk) : findMockOwner(connection, ticket);
  }
  switch (desk) {
    case 'JE': {
      if (ticket.assigned_je_id == null) return null;
      const [rows] = await connection.query(
        `SELECT ${PERSON} FROM mnt_users u WHERE u.id = ? AND u.role = 'JE' AND u.is_active = TRUE`,
        [ticket.assigned_je_id]
      );
      return rows[0] ?? null;
    }
    case 'AE':
      return (await findPinned(connection, ticket.assigned_ae_id, 'AE'))
        ?? resolveAeForScope(connection, { department: ticket.department, campus: ticket.campus });
    case 'SE': {
      const pinned = await findPinned(connection, ticket.assigned_se_id, 'SE');
      if (pinned) return pinned;
      const [rows] = await connection.query(
        `SELECT ${PERSON} FROM mnt_users u
          WHERE u.role = 'SE' AND u.is_active = TRUE AND u.is_demo = FALSE
          ORDER BY EXISTS (SELECT 1 FROM mnt_user_scopes s WHERE s.user_id = u.id AND s.department = ?) DESC, u.id ASC
          LIMIT 1`,
        [ticket.department]
      );
      return rows[0] ?? null;
    }
    case 'DEAN':
    case 'DIRECTOR': {
      const [rows] = await connection.query(
        `SELECT ${PERSON} FROM mnt_users u WHERE u.role = ? AND u.is_active = TRUE AND u.is_demo = FALSE ORDER BY u.id ASC LIMIT 1`,
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
  // A pinned AE/SE (set by the Sysadmin or by the transition) is a legitimate holder even outside scope.
  const pinned = desk === 'AE' ? ticket.assigned_ae_id : desk === 'SE' ? ticket.assigned_se_id : null;
  const scoped = desk === 'AE' && !(pinned != null && pinned === userId);
  const [rows] = await connection.query(
    `SELECT 1 FROM mnt_users u
      WHERE u.id = ? AND u.role = ? AND u.is_active = TRUE
        AND (? = FALSE OR EXISTS (
              SELECT 1 FROM mnt_user_scopes s
               WHERE s.user_id = u.id AND s.department = ? AND (? IS NULL OR s.campus IN (?, 'BOTH'))))`,
    [userId, desk, scoped, ticket.department, campus, campus]
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
    `SELECT id, status, department, campus, applicant_id, is_mock, is_demo, assigned_je_id, assigned_ae_id, assigned_se_id,
            current_desk_user_id
       FROM mnt_tickets WHERE status IN (?)`,
    [DESK_STATUSES]
  );
  let fixed = 0;
  for (const t of tickets) {
    const id = await effectiveOwnerId(connection, t, deskForStatus(t.status));
    if (id !== t.current_desk_user_id) {
      await connection.query('UPDATE mnt_tickets SET current_desk_user_id = ? WHERE id = ?', [id, t.id]);
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
    `SELECT ${PERSON} FROM mnt_users u
      WHERE u.id = ? AND u.role = 'JE' AND u.is_active = TRUE AND u.is_demo = FALSE
        AND EXISTS (SELECT 1 FROM mnt_user_scopes s WHERE s.user_id = u.id AND s.department = ?
                    AND (? IS NULL OR s.campus IN (?, 'BOTH')))`,
    [jeId, department, campus, campus]
  );
  return rows[0] ?? null;
}

const DESKS = ['JE', 'AE', 'SE', 'DEAN', 'DIRECTOR'];

// Who holds every desk of this ticket, for staff viewers only (never the applicant).
// Pinned holders come from the ticket row; unpinned desks resolve the usual way.
// A JE sees only their own desk and which desk holds the ticket, never authority names (same as the audit log).
export async function loadAssignees(connection, ticketRow, staff) {
  const out = {};
  for (const d of DESKS) {
    const owner = await findDeskOwner(connection, ticketRow, d);
    out[d] = owner ? { id: owner.id, name: owner.name } : null;
  }
  const desk = deskForStatus(ticketRow.status);
  let holder = null;
  if (ticketRow.current_desk_user_id != null) {
    const [rows] = await connection.query(
      'SELECT id, name FROM mnt_users WHERE id = ?', [ticketRow.current_desk_user_id]);
    holder = rows[0] ?? null;
  }
  out.current = desk && holder ? { desk, id: holder.id, name: holder.name } : null;
  if (staff === 'JE') {
    for (const d of DESKS) if (d !== 'JE') out[d] = null;
    if (out.current && out.current.desk !== 'JE') out.current = { desk: out.current.desk };
  }
  return out;
}
