import { auth } from '../config/firebase.js';
import pool from '../config/db.js';
import logger from '../utils/logger.js';
import { sendServerError } from '../utils/httpError.js';

export const syncUser = async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided.' });
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
    return res.status(401).json({ success: false, message: 'Invalid or expired token.', requestId: req.id });
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
    const [existingByUid] = await pool.query('SELECT * FROM infra_users WHERE firebase_uid = ?', [uid]);

    let user;

    if (existingByUid.length > 0) {
      user = existingByUid[0];
      // Keep name up to date if available
      if (name && user.name !== name) {
        await pool.query('UPDATE infra_users SET name = ? WHERE id = ?', [name, user.id]);
        user.name = name;
      }
    } else {
      // 2. Check if account already exists with this email (e.g. pre-seeded admin/officer/engineer)
      const [existingByEmail] = await pool.query('SELECT * FROM infra_users WHERE email = ?', [email]);

      if (existingByEmail.length > 0) {
        // Link firebase_uid to the existing account
        await pool.query(
          'UPDATE infra_users SET firebase_uid = ?, name = COALESCE(?, name) WHERE id = ?',
          [uid, name || null, existingByEmail[0].id]
        );
        const [updatedUsers] = await pool.query('SELECT * FROM infra_users WHERE id = ?', [existingByEmail[0].id]);
        user = updatedUsers[0];
      } else {
        // 3. Any Google account: auto-provision as APPLICANT (any domain allowed)
        const displayName = name || email.split('@')[0];
        const [result] = await pool.query(
          `INSERT INTO infra_users (firebase_uid, name, email, role, department, is_active) 
           VALUES (?, ?, ?, 'APPLICANT', 'General', TRUE)`,
          [uid, displayName, email]
        );
        
        const [newUsers] = await pool.query('SELECT * FROM infra_users WHERE id = ?', [result.insertId]);
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