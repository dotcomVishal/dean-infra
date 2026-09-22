import { auth } from '../config/firebase.js';
import pool from '../config/db.js';

export const requireAuth = async (req, res, next) => {
  let token;

  // Extract the Bearer token from the Authorization header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Unauthorized: No token provided' });
  }

  try {
    // 1. Verify the token using Firebase Admin SDK
    const decodedToken = await auth.verifyIdToken(token);
    const firebase_uid = decodedToken.uid;

    // 2. Look up the user in our MySQL database using their unique Firebase UID
    let [users] = await pool.query(
      'SELECT id, name, email, role, department, is_active FROM users WHERE firebase_uid = ?',
      [firebase_uid]
    );

    if (users.length === 0 && decodedToken.email) {
      // Check if user exists by email (pre-seeded account)
      const [byEmail] = await pool.query(
        'SELECT id, name, email, role, department, is_active FROM users WHERE email = ?',
        [decodedToken.email]
      );

      if (byEmail.length > 0) {
        await pool.query('UPDATE users SET firebase_uid = ? WHERE id = ?', [firebase_uid, byEmail[0].id]);
        users = byEmail;
      } else {
        // Any google account: auto-provision as APPLICANT
        const displayName = decodedToken.name || decodedToken.email.split('@')[0];
        const [result] = await pool.query(
          `INSERT INTO users (firebase_uid, name, email, role, department, is_active) 
           VALUES (?, ?, ?, 'APPLICANT', 'General', TRUE)`,
          [firebase_uid, displayName, decodedToken.email]
        );
        const [created] = await pool.query('SELECT id, name, email, role, department, is_active FROM users WHERE id = ?', [result.insertId]);
        users = created;
      }
    }

    if (users.length === 0 || !users[0].is_active) {
      return res.status(403).json({ 
        success: false, 
        message: 'Forbidden: Account does not exist or has been deactivated.' 
      });
    }

    // 3. Attach the secure, database-verified user record to the request
    req.user = users[0]; 
    next();
    
  } catch (error) {
    console.error('Firebase Auth Error:', error.message);
    return res.status(403).json({ success: false, message: 'Unauthorized: Invalid or expired token' });
  }
};