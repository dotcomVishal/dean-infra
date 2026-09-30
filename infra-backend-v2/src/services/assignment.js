// ============================================================
//  FAIR AUTO-ASSIGNMENT ENGINE (plan.md §3.2, §4 Phase 3 item 2)
//
//  Rules, in order:
//    1. Candidate JEs = active, scope matches (department, campus) or
//       (department, 'BOTH'), and no user_availability row covers NOW().
//       A JE who raised the ticket is ranked last: they get it only when no
//       other JE is available (plan2.md decision 1, self-assignment is
//       allowed and flagged in the audit log, never blocked).
//    2. Pick the one with the lowest open-ticket count; ties broken by
//       last_assigned_at (round robin), then id (deterministic).
//    3. SELECT ... FOR UPDATE SKIP LOCKED on the candidate row, so two
//       tickets raised at the same instant never pick the same JE: a
//       transaction that already holds the top candidate's row makes the
//       next transaction skip straight to the next-least-loaded JE instead
//       of blocking or double-booking. Done in two steps -- an unlocked scan
//       to rank candidates, then a single-table SKIP LOCKED claim per
//       candidate in rank order -- because MySQL's SKIP LOCKED only covers
//       the table(s) actually named in the locking SELECT's FROM clause; the
//       EXISTS/NOT EXISTS scope and leave checks below are correlated
//       subqueries, and running the whole ranking query itself under
//       FOR UPDATE would take plain (blocking, non-skippable) locks on the
//       user_scopes/user_availability rows it reads, deadlocking concurrent
//       requests instead of routing around them.
//    4. Nobody available -> UNASSIGNED, routed to the AE for this exact
//       (department, campus). Never falls back to the other campus.
//
//  Every exported function takes an open transaction `connection` -- the
//  caller (ticketController.createTicket) owns beginTransaction/commit, so
//  the pick and the ticket insert that follows it are one atomic unit.
// ============================================================

import { resolveAeForScope, fallbackSysadmin } from '../models/deskModel.js';

// A JE "counts" as busy while their ticket is still open with them
// (RETURNED_TO_JE is this codebase's name for "changes requested").
const OPEN_WITH_JE_STATUSES = ['ASSIGNED_TO_JE', 'RETURNED_TO_JE'];

/**
 * Picks the least-loaded available JE for a (department, campus) scope and
 * locks their row so a concurrent pick cannot land on the same person.
 * @returns {Promise<{id:number, name:string, email:string}|null>}
 */
export async function pickAvailableJe(connection, { department, campus, applicantId = null }) {
  // Step 1: rank candidates. Plain read, no lock -- open-ticket counts are a
  // snapshot used only to order the claim attempts below.
  const [candidates] = await connection.query(
    `SELECT u.id
       FROM users u
      WHERE u.role = 'JE' AND u.is_active = TRUE
        AND EXISTS (
          SELECT 1 FROM user_scopes s
           WHERE s.user_id = u.id AND s.department = ? AND s.campus IN (?, 'BOTH')
        )
        AND NOT EXISTS (
          SELECT 1 FROM user_availability a
           WHERE a.user_id = u.id AND NOW() BETWEEN a.start_at AND a.end_at
        )
      ORDER BY (u.id = ?) ASC,
        (
          SELECT COUNT(*) FROM tickets t
           WHERE t.assigned_je_id = u.id AND t.status IN (?) AND t.is_mock = FALSE
        ) ASC,
        u.last_assigned_at ASC,
        u.id ASC`,
    [department, campus, applicantId, OPEN_WITH_JE_STATUSES]
  );

  // Step 2: claim in rank order. A single-table FOR UPDATE SKIP LOCKED per
  // row -- the row a concurrent transaction already holds is skipped, not
  // blocked on, so this transaction falls through to the next-least-loaded
  // JE instead of waiting.
  for (const candidate of candidates) {
    const [locked] = await connection.query(
      `SELECT id, name, email FROM users WHERE id = ? FOR UPDATE SKIP LOCKED`,
      [candidate.id]
    );
    if (locked.length > 0) return locked[0];
  }
  return null;
}

/**
 * The whole engine: pick a JE, or fall back to UNASSIGNED at the scope's AE.
 * @returns {Promise<{
 *   status: 'ASSIGNED_TO_JE'|'UNASSIGNED',
 *   assignedJeId: number|null,
 *   currentDeskUserId: number,
 *   deskUser: {id:number, name:string, email:string},
 * }>}
 */
export async function assignTicket(connection, { department, campus, applicantId = null }) {
  const je = await pickAvailableJe(connection, { department, campus, applicantId });
  if (je) {
    await connection.query('UPDATE users SET last_assigned_at = NOW() WHERE id = ?', [je.id]);
    return { status: 'ASSIGNED_TO_JE', assignedJeId: je.id, currentDeskUserId: je.id, deskUser: je };
  }

  const ae = (await resolveAeForScope(connection, { department, campus })) || (await fallbackSysadmin(connection));
  if (!ae) {
    throw new Error(
      `No JE available for ${department}/${campus}, and no AE or SYSADMIN configured to receive it.`
    );
  }
  return { status: 'UNASSIGNED', assignedJeId: null, currentDeskUserId: ae.id, deskUser: ae };
}
