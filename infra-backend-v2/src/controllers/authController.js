import { auth } from '../config/firebase.js';
import pool from '../config/db.js';
import logger from '../utils/logger.js';
import { sendServerError } from '../utils/httpError.js';
import { demoEnabled, findDemoAccount, demoPasswordMatches, demoAccountsReady } from '../config/demo.js';

export const syncUser = async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Session expired. Sign in again.' });
  }

  const token = authHeader.split(' ')[1];

  // S12: a Firebase verification failure is a client problem (401), and its raw
  // message is logged, never returned. Anything after this that throws is a 500.
  let decodedToken;
  try {
    decodedToken = await auth.verifyIdToken(token);
  } catch (error) {
    logger.warn('auth sync: token verification failed', {
      requestId: req.id, firebaseCode: error.code, reason: error.message,
    });
    return res.status(401).json({ success: false, message: 'Session expired. Sign in again.', requestId: req.id });
  }

  try {
    const { uid, email, name } = decodedToken;

    // S4: this is the exact point where a Firebase identity gets linked to a
    // pre-seeded account by email. Require Google, and a verified email, so
    // the link can never be claimed by any other provider.
    if (decodedToken.email_verified !== true || decodedToken.firebase?.sign_in_provider !== 'google.com') {
      return res.status(403).json({ success: false, message: 'Sign in with a verified Google account.' });
    }

    if (!email) {
      return res.status(400).json({ success: false, message: 'Google account has no verified email address.' });
    }

    // 1. Look up user by firebase_uid
    const [existingByUid] = await pool.query('SELECT * FROM mnt_users WHERE firebase_uid = ?', [uid]);

    let user;

    if (existingByUid.length > 0) {
      user = existingByUid[0];
      // Keep name up to date if available
      if (name && user.name !== name) {
        await pool.query('UPDATE mnt_users SET name = ? WHERE id = ?', [name, user.id]);
        user.name = name;
      }
    } else {
      // 2. Check if account already exists with this email (e.g. pre-seeded admin/officer/engineer)
      const [existingByEmail] = await pool.query('SELECT * FROM mnt_users WHERE email = ?', [email]);

      if (existingByEmail.length > 0) {
        // Link firebase_uid to the existing account
        await pool.query(
          'UPDATE mnt_users SET firebase_uid = ?, name = COALESCE(?, name) WHERE id = ?',
          [uid, name || null, existingByEmail[0].id]
        );
        const [updatedUsers] = await pool.query('SELECT * FROM mnt_users WHERE id = ?', [existingByEmail[0].id]);
        user = updatedUsers[0];
      } else {
        // 3. Any Google account: auto-provision as APPLICANT (any domain allowed)
        const displayName = name || email.split('@')[0];
        const [result] = await pool.query(
          `INSERT INTO mnt_users (firebase_uid, name, email, role, department, is_active) 
           VALUES (?, ?, ?, 'APPLICANT', 'General', TRUE)`,
          [uid, displayName, email]
        );
        
        const [newUsers] = await pool.query('SELECT * FROM mnt_users WHERE id = ?', [result.insertId]);
        user = newUsers[0];
      }
    }

    if (!user.is_active) {
      return res.status(403).json({ 
        success: false, 
        message: 'Your account has been deactivated. Please contact the administrator.' 
      });
    }

    res.json({ success: true, user });

  } catch (error) {
    return sendServerError(req, res, error, 'syncUser');
  }
};

// POST /api/auth/ldap: demo stand-in for the LDAP form (Agent/demo-plan.md). Fixed usernames, one shared
// password from the environment, answered with a Firebase custom token for the matching demo account.
export const demoLdapLogin = async (req, res) => {
  const { username, password } = req.body ?? {};
  try {
    if (!demoEnabled() || !(await demoAccountsReady(pool))) {
      return res.status(503).json({ success: false, code: 'LDAP_DISABLED', message: 'LDAP sign-in is not available.' });
    }
    const account = findDemoAccount(username);
    // Always compare the password, so a wrong username and a wrong password take the same time.
    const passwordOk = demoPasswordMatches(password);
    if (!account || !passwordOk) {
      logger.warn('demo ldap: login refused', { requestId: req.id, username: String(username ?? '').slice(0, 64) });
      return res.status(401).json({ success: false, message: 'Wrong LDAP username or password.' });
    }
    const [rows] = await pool.query(
      'SELECT id, name, email, role, department, is_active, is_demo FROM mnt_users WHERE firebase_uid = ? AND is_demo = TRUE',
      [account.firebase_uid]);
    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(503).json({ success: false, code: 'LDAP_DISABLED', message: 'LDAP sign-in is not available.' });
    }
    const token = await auth.createCustomToken(account.firebase_uid);
    logger.info('demo ldap: login ok', { requestId: req.id, username: account.username, role: account.role });
    res.json({ success: true, token, user: { ...user, is_demo: true } });
  } catch (error) {
    return sendServerError(req, res, error, 'demoLdapLogin');
  }
};
