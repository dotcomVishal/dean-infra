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
    const [users] = await pool.query(
      'SELECT id, name, email, role, department FROM users WHERE firebase_uid = ? AND is_active = TRUE',
      [firebase_uid]
    );

    if (users.length === 0) {
      return res.status(403).json({ 
        success: false, 
        message: 'Forbidden: User identity verified, but account does not exist in the Infra system.' 
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