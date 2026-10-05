// Dean and Director are single-holder desks (plan2.md decision 3): exactly one
// active user each. Migration 008 creates a `.invalid` placeholder when a desk
// has nobody; the Sysadmin later swaps in the real e-mail. This reports the
// state so the boot log and the admin dashboard can warn about it.
import logger from '../utils/logger.js';
import { isPlaceholderEmail } from '../utils/mailer.js';

const SINGLE_HOLDER_ROLES = ['DEAN', 'DIRECTOR'];

/**
 * @returns {Promise<Record<string, {count:number, placeholder:boolean, ok:boolean, message:string|null}>>}
 */
export async function checkSingleHolders(connection) {
  const [rows] = await connection.query(
    `SELECT role, email FROM users WHERE role IN (?) AND is_active = TRUE AND is_demo = FALSE`, [SINGLE_HOLDER_ROLES]);
  const out = {};
  for (const role of SINGLE_HOLDER_ROLES) {
    const holders = rows.filter((r) => r.role === role);
    const placeholder = holders.length > 0 && holders.every((h) => isPlaceholderEmail(h.email));
    const label = role === 'DEAN' ? 'Dean' : 'Director';
    let message = null;
    if (holders.length === 0) message = `No active ${label}. Add or activate one in Users.`;
    else if (holders.length > 1) message = `${holders.length} active ${label}s. Deactivate all but one in Users.`;
    else if (placeholder) message = `${label} still uses a placeholder e-mail. Set the real e-mail in Users.`;
    out[role] = { count: holders.length, placeholder, ok: message === null, message };
  }
  return out;
}

/** Boot check: logs an ALERT for every desk that is not exactly one real holder. */
export async function logDeskHealth(connection) {
  const health = await checkSingleHolders(connection);
  for (const [role, h] of Object.entries(health)) {
    if (!h.ok) logger.error('ALERT: desk holder check failed', { role, count: h.count, placeholder: h.placeholder, message: h.message });
  }
  return health;
}
