import { auth } from '../config/firebase.js';
import pool from '../config/db.js';
import logger from '../utils/logger.js';
import { demoEnabled, DEMO_UIDS } from '../config/demo.js';

const USER_COLUMNS = 'id, name, email, role, department, is_active, is_demo';

export const requireAuth = async (req, res, next) => {
  let token;

  // Extract the Bearer token from the Authorization header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Session expired. Sign in again.' });
  }

  try {
    // 1. Verify the token using Firebase Admin SDK
    const decodedToken = await auth.verifyIdToken(token);

    const firebase_uid = decodedToken.uid;
    const provider = decodedToken.firebase?.sign_in_provider;
    let users;

    if (provider === 'custom') {
      // Demo LDAP login: a custom token minted by this backend. Accepted only while the demo switch is
      // on, for a fixed uid list, and only for a row flagged is_demo. Never provisions, never links by e-mail.
      if (!demoEnabled() || !DEMO_UIDS.has(firebase_uid)) {
        return res.status(401).json({ success: false, message: 'Session expired. Sign in again.', requestId: req.id });
      }
      [users] = await pool.query(`SELECT ${USER_COLUMNS} FROM mnt_users WHERE firebase_uid = ? AND is_demo = TRUE`, [firebase_uid]);
    } else {
      // S4: a Firebase account used to be linked to a pre-seeded account by
      // email alone, with no check on how that email was proven. If any
      // non-Google provider (e.g. email/password) is ever enabled in Firebase,
      // anyone could claim "director@..." and become the Director.
      if (decodedToken.email_verified !== true || provider !== 'google.com') {
        return res.status(403).json({
          success: false,
          message: 'Sign in with a verified Google account.',
        });
      }

      // 2. Look up the user in our MySQL database using their unique Firebase UID
      [users] = await pool.query(`SELECT ${USER_COLUMNS} FROM mnt_users WHERE firebase_uid = ?`, [firebase_uid]);

      if (users.length === 0 && decodedToken.email) {
        // Check if user exists by email (pre-seeded account)
        const [byEmail] = await pool.query(`SELECT ${USER_COLUMNS} FROM mnt_users WHERE email = ?`, [decodedToken.email]);

        if (byEmail.length > 0) {
          // A Google account can never link to (and so become) a demo account.
          if (!byEmail[0].is_demo) {
            await pool.query('UPDATE mnt_users SET firebase_uid = ? WHERE id = ?', [firebase_uid, byEmail[0].id]);
            users = byEmail;
          }
        } else {
          // Any google account: auto-provision as APPLICANT
          const displayName = decodedToken.name || decodedToken.email.split('@')[0];
          const [result] = await pool.query(
            `INSERT INTO mnt_users (firebase_uid, name, email, role, department, is_active) 
             VALUES (?, ?, ?, 'APPLICANT', 'General', TRUE)`,
            [firebase_uid, displayName, decodedToken.email]
          );
          const [created] = await pool.query(`SELECT ${USER_COLUMNS} FROM mnt_users WHERE id = ?`, [result.insertId]);
          users = created;
        }
      }

      // A Google token whose uid row is a demo account is refused.
      if (users.length > 0 && users[0].is_demo) users = [];
    }

    if (users.length === 0 || !users[0].is_active) {
      return res.status(403).json({ 
        success: false, 
        message: 'This account is not active. Contact the administrator.' 
      });
    }

    // 3. Attach the secure, database-verified user record to the request
    req.user = { ...users[0], is_demo: !!users[0].is_demo };
    next();
    
  } catch (error) {
    logger.warn('auth: token rejected', { requestId: req.id, code: error.code, reason: error.message });
    // F1: an expired token used to come back as 403, which the frontend
    // interceptor did not treat as a logout signal, so every session silently
    // broke one hour after login instead of prompting a re-login.
    return res.status(401).json({ success: false, message: 'Session expired. Sign in again.', requestId: req.id });
  }
};