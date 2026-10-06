// Shared fixtures for integration tests. They create their OWN rows (unique
// `ci-` emails) in the otherwise-unused `Administration` department, and delete
// them afterwards, so the tests neither depend on scripts/seed-staff.mjs nor
// disturb real data if run against a dev database.
import './guard.mjs';
import { randomUUID } from 'crypto';
import pool from '../../src/config/db.js';

export const DEPT = 'Administration';
const run = randomUUID().slice(0, 8);
const created = { users: [], tickets: [] };

export async function makeUser({ role, campus = null, scopes = [], name }) {
  const tag = randomUUID().slice(0, 6);
  const [r] = await pool.query(
    `INSERT INTO mnt_users (firebase_uid, name, email, role, department, campus, is_active)
     VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
    [`ci-${run}-${tag}`, name ?? `CI ${role} ${tag}`, `ci-${run}-${tag}@test.local`, role, DEPT, campus]
  );
  created.users.push(r.insertId);
  for (const s of scopes) {
    await pool.query('INSERT INTO mnt_user_scopes (user_id, department, campus) VALUES (?, ?, ?)', [r.insertId, DEPT, s]);
  }
  return r.insertId;
}

export async function makeOpenTicket(applicantId, jeId, status = 'ASSIGNED_TO_JE') {
  const [r] = await pool.query(
    `INSERT INTO mnt_tickets (applicant_id, assigned_je_id, department, campus, description, status)
     VALUES (?, ?, 'Civil', 'NORTH', 'ci fixture', ?)`,
    [applicantId, jeId, status]
  );
  created.tickets.push(r.insertId);
  return r.insertId;
}

export async function putOnLeave(userId, createdBy) {
  const [r] = await pool.query(
    `INSERT INTO mnt_user_availability (user_id, start_at, end_at, reason, created_by)
     VALUES (?, NOW() - INTERVAL 1 HOUR, NOW() + INTERVAL 1 DAY, 'ci', ?)`,
    [userId, createdBy]
  );
  return () => pool.query('DELETE FROM mnt_user_availability WHERE id = ?', [r.insertId]);
}

/** Run `fn(conn)` inside a transaction that is always rolled back. */
export async function inRolledBackTx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    return await fn(conn);
  } finally {
    await conn.rollback();
    conn.release();
  }
}

export async function cleanup() {
  if (created.tickets.length) await pool.query('DELETE FROM mnt_tickets WHERE id IN (?)', [created.tickets]);
  if (created.users.length) {
    await pool.query('DELETE FROM mnt_notifications WHERE to_user_id IN (?)', [created.users]); // weekly digests have no ticket to cascade from
    await pool.query('DELETE FROM mnt_user_availability WHERE user_id IN (?) OR created_by IN (?)', [created.users, created.users]);
    await pool.query('DELETE FROM mnt_users WHERE id IN (?)', [created.users]); // user_scopes cascade
  }
  created.tickets.length = 0;
  created.users.length = 0;
}

export { pool };
