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

/**
 * Insert a person: a core_users row, plus a mnt_members row when they have a module role
 * (no row = APPLICANT). `db` is the pool or a connection. Returns the new id.
 */
export async function insertUser(db, { firebaseUid, name, email, role = 'APPLICANT', department = DEPT, campus = null, isActive = true, isDemo = false, phone = null }) {
  const [r] = await db.query(
    'INSERT INTO core_users (firebase_uid, name, email, phone, is_active, is_demo) VALUES (?, ?, ?, ?, ?, ?)',
    [firebaseUid, name, email, phone, isActive, isDemo]);
  if (role !== 'APPLICANT' || campus !== null) {
    await db.query('INSERT INTO mnt_members (user_id, role, department, campus) VALUES (?, ?, ?, ?)', [r.insertId, role, department, campus]);
  }
  return r.insertId;
}

export async function makeUser({ role, campus = null, scopes = [], name }) {
  const tag = randomUUID().slice(0, 6);
  const id = await insertUser(pool, {
    firebaseUid: `ci-${run}-${tag}`, name: name ?? `CI ${role} ${tag}`, email: `ci-${run}-${tag}@test.local`, role, campus,
  });
  created.users.push(id);
  for (const s of scopes) {
    await pool.query('INSERT INTO mnt_user_scopes (user_id, department, campus) VALUES (?, ?, ?)', [id, DEPT, s]);
  }
  return id;
}

/** Block or allow people account-wide (core_users.is_active). `ids` is an id or a list. */
export const setActive = (ids, active, db = pool) =>
  db.query('UPDATE core_users SET is_active = ? WHERE id IN (?)', [active, [].concat(ids)]);

/** Block or allow every member holding `role` in this module only (mnt_members.is_active). */
export const setRoleActive = (role, active, db = pool) =>
  db.query('UPDATE mnt_members SET is_active = ? WHERE role = ?', [active, role]);

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
    await pool.query('DELETE FROM core_users WHERE id IN (?)', [created.users]); // mnt_members and mnt_user_scopes cascade
  }
  created.tickets.length = 0;
  created.users.length = 0;
}

export { pool };
