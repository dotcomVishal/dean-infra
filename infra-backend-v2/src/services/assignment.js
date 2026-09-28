// ============================================================
//  FAIR AUTO-ASSIGNMENT ENGINE (plan.md §3.2, §4 Phase 3 item 2)
//
//  Rules, in order:
//    1. Candidate JEs = active, scope matches (department, campus) or
//       (department, 'BOTH'), and no user_availability row covers NOW().
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

// A JE/AE "counts" as busy while their ticket is still open with them. The
// workflow rewrite (Phase 4) renames RETURNED_TO_JE -> CHANGES_REQUESTED;
// until then this is the current model's equivalent set.
const OPEN_WITH_JE_STATUSES = ['ASSIGNED_TO_JE', 'RETURNED_TO_JE'];

/**
 * Picks the least-loaded available JE for a (department, campus) scope and
 * locks their row so a concurrent pick cannot land on the same person.
 * @returns {Promise<{id:number, name:string, email:string}|null>}
 */
export async function pickAvailableJe(connection, { department, campus }) {
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
      ORDER BY (
          SELECT COUNT(*) FROM tickets t
           WHERE t.assigned_je_id = u.id AND t.status IN (?)
        ) ASC,
        u.last_assigned_at ASC,
        u.id ASC`,
    [department, campus, OPEN_WITH_JE_STATUSES]
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
 * The AE for a (department, campus) scope -- exact match or a BOTH-campus
 * AE. Never the AE of the other campus (plan.md Q8: no cross-campus
 * fallback).
 */
async function resolveAeForScope(connection, { department, campus }) {
  const [rows] = await connection.query(
    `SELECT u.id, u.name, u.email
       FROM users u
       JOIN user_scopes s ON s.user_id = u.id
      WHERE u.role = 'AE' AND u.is_active = TRUE
        AND s.department = ? AND s.campus IN (?, 'BOTH')
      ORDER BY u.id ASC
      LIMIT 1`,
    [department, campus]
  );
  return rows[0] ?? null;
}

/** Last-resort desk owner if a scope has no AE configured at all (a roster
 *  gap, not an expected outcome) -- the ticket must still land somewhere. */
async function fallbackSysadmin(connection) {
  const [rows] = await connection.query(
    `SELECT id, name, email FROM users WHERE role = 'SYSADMIN' AND is_active = TRUE ORDER BY id ASC LIMIT 1`
  );
  return rows[0] ?? null;
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
export async function assignTicket(connection, { department, campus }) {
  const je = await pickAvailableJe(connection, { department, campus });
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
