// ============================================================
//  JE/AE AVAILABILITY (plan.md §3.1 user_availability, §4 Phase 3 item 2)
//
//  A JE is available when active and no row here covers NOW() -- checked by
//  services/assignment.js. Marking leave = INSERT a window; removing leave
//  (including ending it early) = DELETE the row.
//
//  Who can act on whose leave:
//    - A JE or AE can always mark/remove their own leave.
//    - AE, SE and SYSADMIN can mark/remove leave for a JE inside their own
//      scope (plan.md §3.1). SYSADMIN has no scope restriction.
// ============================================================
import { z } from 'zod';
import pool from '../config/db.js';

const markLeaveSchema = z
  .object({
    user_id: z.coerce.number().int().positive().optional(),
    start_at: z.coerce.date({ message: 'start_at must be a valid date/time.' }),
    end_at: z.coerce.date({ message: 'end_at must be a valid date/time.' }),
    reason: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().trim().max(255).optional()
    ),
  })
  .refine((data) => data.end_at > data.start_at, {
    message: 'end_at must be after start_at.',
    path: ['end_at'],
  });

/** Does `actor` (an AE/SE) have a scope in user_scopes that covers `target`'s
 *  scope? SYSADMIN bypasses this entirely; JEs may only ever target themselves
 *  (enforced by the caller before this runs). */
async function actorCoversTarget(connection, actorId, targetId) {
  const [rows] = await connection.query(
    `SELECT 1
       FROM user_scopes actor_scope
       JOIN user_scopes target_scope
         ON target_scope.department = actor_scope.department
        AND (target_scope.campus = actor_scope.campus
             OR actor_scope.campus = 'BOTH'
             OR target_scope.campus = 'BOTH')
      WHERE actor_scope.user_id = ? AND target_scope.user_id = ?
      LIMIT 1`,
    [actorId, targetId]
  );
  return rows.length > 0;
}

export const markLeave = async (req, res) => {
  const parsed = markLeaveSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Invalid leave data.',
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const { start_at, end_at, reason } = parsed.data;
  const targetUserId = parsed.data.user_id ?? req.user.id;
  const actorId = req.user.id;
  const actorRole = req.user.role;

  try {
    if (targetUserId !== actorId) {
      // Only AE/SE/SYSADMIN may mark leave for someone else, and only for a JE.
      if (!['AE', 'SE', 'SYSADMIN'].includes(actorRole)) {
        return res.status(403).json({
          success: false,
          message: 'You may only mark your own leave.',
        });
      }
      const [targetRows] = await pool.query('SELECT id, role, is_active FROM users WHERE id = ?', [targetUserId]);
      if (targetRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Target user not found.' });
      }
      if (targetRows[0].role !== 'JE') {
        return res.status(400).json({ success: false, message: 'Leave can only be marked for a JE on behalf of someone else.' });
      }
      if (actorRole !== 'SYSADMIN' && !(await actorCoversTarget(pool, actorId, targetUserId))) {
        return res.status(403).json({
          success: false,
          message: 'That JE is outside your scope.',
        });
      }
    } else if (!['JE', 'AE'].includes(actorRole)) {
      return res.status(403).json({ success: false, message: 'Only a JE or AE can mark their own leave.' });
    }

    const [result] = await pool.query(
      `INSERT INTO user_availability (user_id, start_at, end_at, reason, created_by) VALUES (?, ?, ?, ?, ?)`,
      [targetUserId, start_at, end_at, reason ?? null, actorId]
    );

    res.json({
      success: true,
      leave: {
        id: result.insertId,
        user_id: targetUserId,
        start_at,
        end_at,
        reason: reason ?? null,
      },
    });
  } catch (error) {
    console.error('markLeave error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const removeLeave = async (req, res) => {
  const leaveId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(leaveId) || leaveId <= 0) {
    return res.status(400).json({ success: false, code: 'BAD_ID', message: 'id must be a positive integer.' });
  }

  try {
    const [rows] = await pool.query('SELECT id, user_id FROM user_availability WHERE id = ?', [leaveId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Leave entry not found.' });
    }
    const targetUserId = rows[0].user_id;
    const actorId = req.user.id;
    const actorRole = req.user.role;

    if (targetUserId !== actorId) {
      if (!['AE', 'SE', 'SYSADMIN'].includes(actorRole)) {
        return res.status(403).json({ success: false, message: 'You may only remove your own leave.' });
      }
      if (actorRole !== 'SYSADMIN' && !(await actorCoversTarget(pool, actorId, targetUserId))) {
        return res.status(403).json({ success: false, message: 'That JE is outside your scope.' });
      }
    }

    await pool.query('DELETE FROM user_availability WHERE id = ?', [leaveId]);
    res.json({ success: true, message: 'Leave entry removed.' });
  } catch (error) {
    console.error('removeLeave error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/** Own leave, or (for AE/SE/SYSADMIN) leave for JEs in scope. */
export const listAvailability = async (req, res) => {
  const actorId = req.user.id;
  const actorRole = req.user.role;
  const requestedUserId = req.query.user_id ? Number.parseInt(req.query.user_id, 10) : null;
  const privileged = ['AE', 'SE', 'SYSADMIN'].includes(actorRole);

  try {
    // Case 1: asking about a specific other user.
    if (requestedUserId && requestedUserId !== actorId) {
      if (!privileged) {
        return res.status(403).json({ success: false, message: 'You may only view your own leave.' });
      }
      if (actorRole !== 'SYSADMIN' && !(await actorCoversTarget(pool, actorId, requestedUserId))) {
        return res.status(403).json({ success: false, message: 'That JE is outside your scope.' });
      }
      const [rows] = await pool.query(
        `SELECT id, user_id, start_at, end_at, reason, created_by, created_at
           FROM user_availability WHERE user_id = ? ORDER BY start_at DESC`,
        [requestedUserId]
      );
      return res.json({ success: true, availability: rows });
    }

    // Case 2: no target given, and the actor is AE/SE/SYSADMIN -- their
    // whole scope (every JE they can also mark leave for).
    if (!requestedUserId && privileged) {
      const [rows] = actorRole === 'SYSADMIN'
        ? await pool.query(
            `SELECT a.id, a.user_id, u.name AS user_name, a.start_at, a.end_at, a.reason, a.created_by, a.created_at
               FROM user_availability a JOIN users u ON u.id = a.user_id
              ORDER BY a.start_at DESC`
          )
        : await pool.query(
            `SELECT a.id, a.user_id, u.name AS user_name, a.start_at, a.end_at, a.reason, a.created_by, a.created_at
               FROM user_availability a
               JOIN users u ON u.id = a.user_id
              WHERE u.role = 'JE' AND EXISTS (
                SELECT 1 FROM user_scopes actor_scope
                 JOIN user_scopes target_scope ON target_scope.department = actor_scope.department
                  AND (target_scope.campus = actor_scope.campus
                       OR actor_scope.campus = 'BOTH'
                       OR target_scope.campus = 'BOTH')
                WHERE actor_scope.user_id = ? AND target_scope.user_id = a.user_id
              )
              ORDER BY a.start_at DESC`,
            [actorId]
          );
      return res.json({ success: true, availability: rows });
    }

    // Case 3: own leave (a JE, or AE/SE/SYSADMIN explicitly asking for self).
    const [rows] = await pool.query(
      `SELECT id, user_id, start_at, end_at, reason, created_by, created_at
         FROM user_availability WHERE user_id = ? ORDER BY start_at DESC`,
      [actorId]
    );
    return res.json({ success: true, availability: rows });
  } catch (error) {
    console.error('listAvailability error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
