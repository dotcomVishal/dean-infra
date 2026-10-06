// Demo LDAP login: one demo account per role (Agent/demo-plan.md).
// Everything demo lives here. Off unless DEMO_LDAP_ENABLED is exactly "true"
// and DEMO_LDAP_PASSWORD has at least 12 characters.

import crypto from 'node:crypto';
import logger, { errorFields } from '../utils/logger.js';

const MIN_PASSWORD_LENGTH = 12;

const ACCOUNTS = [
  { username: 'demo.applicant',  role: 'APPLICANT',  name: 'Arjun Mehta',  department: 'General' },
  { username: 'demo.je',         role: 'JE',         name: 'Rohan Verma',         department: 'Civil' },
  { username: 'demo.ae',         role: 'AE',         name: 'Neha Kulkarni',         department: 'Civil' },
  { username: 'demo.se',         role: 'SE',         name: 'Sanjay Iyer',         department: 'Civil' },
  { username: 'demo.dean',       role: 'DEAN',       name: 'Meera Nair',       department: 'Administration' },
  { username: 'demo.director',   role: 'DIRECTOR',   name: 'Vikram Rao',   department: 'Administration' },
  { username: 'demo.clerical',   role: 'CLERICAL',   name: 'Kavita Joshi',   department: 'Administration' },
  { username: 'demo.accountant', role: 'ACCOUNTANT', name: 'Anil Desai', department: 'Administration' },
  { username: 'demo.sysadmin',   role: 'SYSADMIN',   name: 'Priya Menon',   department: 'Administration' },
].map((a) => ({
  ...a,
  firebase_uid: `demo_${a.role.toLowerCase()}`,
  email: `${a.username}@demo.invalid`,
}));

export const DEMO_ACCOUNTS = Object.freeze(ACCOUNTS);
export const DEMO_UIDS = Object.freeze(new Set(ACCOUNTS.map((a) => a.firebase_uid)));

/** The switch. Fail closed: anything but "true" with a long enough password is off. */
export function demoEnabled() {
  return process.env.DEMO_LDAP_ENABLED === 'true'
    && (process.env.DEMO_LDAP_PASSWORD ?? '').length >= MIN_PASSWORD_LENGTH;
}

export const findDemoAccount = (username) =>
  DEMO_ACCOUNTS.find((a) => a.username === String(username ?? '').trim().toLowerCase()) ?? null;

export function demoPasswordMatches(candidate) {
  const hash = (s) => crypto.createHash('sha256').update(String(s ?? '')).digest();
  return crypto.timingSafeEqual(hash(candidate), hash(process.env.DEMO_LDAP_PASSWORD ?? ''));
}

/**
 * Boot step. Switch on: upsert the accounts and make them active.
 * Switch off: deactivate every demo user. Never throws and never exits.
 */
export async function syncDemoAccounts(connection) {
  try {
    if (process.env.DEMO_LDAP_ENABLED === 'true' && !demoEnabled()) {
      logger.warn('demo login stays off: DEMO_LDAP_PASSWORD must be at least 12 characters');
    }
    if (!demoEnabled()) {
      await connection.query('UPDATE mnt_users SET is_active = FALSE WHERE is_demo = TRUE');
      return false;
    }
    for (const a of DEMO_ACCOUNTS) {
      await connection.query(
        `INSERT INTO mnt_users (firebase_uid, name, email, role, department, is_active, is_demo)
         VALUES (?, ?, ?, ?, ?, TRUE, TRUE)
         ON DUPLICATE KEY UPDATE name = VALUES(name), email = VALUES(email), role = VALUES(role),
           department = VALUES(department), is_active = TRUE, is_demo = TRUE`,
        [a.firebase_uid, a.name, a.email, a.role, a.department]
      );
    }
    logger.info('demo accounts ready', { count: DEMO_ACCOUNTS.length });
    return true;
  } catch (err) {
    logger.error('demo account sync failed; demo login unavailable', errorFields(err));
    return false;
  }
}

/**
 * The ticket-world filter. A real user sees real tickets (not mock); a demo user sees demo tickets only.
 * `prefix` is the table alias including the dot, e.g. 't.', or '' for an unaliased query.
 */
export const worldClause = (user, prefix = 't.') =>
  user?.is_demo ? `${prefix}is_demo = TRUE` : `${prefix}is_mock = FALSE`;

/** Which users a viewer may list: real users for a real viewer, demo accounts for a demo viewer. */
export const userWorldClause = (user, prefix = 'u.') =>
  user?.is_demo ? `${prefix}is_demo = TRUE` : `${prefix}is_demo = FALSE`;

/** The demo user of a role, by fixed firebase_uid. Does not filter on is_active (kept demo tickets must not move). */
export async function findDemoUser(connection, role) {
  const [rows] = await connection.query(
    `SELECT id, name, email, role FROM mnt_users WHERE firebase_uid = ? AND is_demo = TRUE`,
    [`demo_${String(role).toLowerCase()}`]
  );
  return rows[0] ?? null;
}

/** True when every demo account has a row and is active (login is only offered then). */
export async function demoAccountsReady(connection) {
  const [rows] = await connection.query(
    'SELECT COUNT(*) AS n FROM mnt_users WHERE is_demo = TRUE AND is_active = TRUE AND firebase_uid IN (?)',
    [[...DEMO_UIDS]]
  );
  return rows[0].n === DEMO_ACCOUNTS.length;
}
