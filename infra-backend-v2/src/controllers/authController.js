import { auth } from '../config/firebase.js';
import pool from '../config/db.js';

export const syncUser = async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decodedToken = await auth.verifyIdToken(token);

    const { uid, email, name } = decodedToken;

    const [users] = await pool.query('SELECT * FROM users WHERE firebase_uid = ?', [uid]);

    let user;

    if (users.length === 0) {
      const [result] = await pool.query(
        `INSERT INTO users (firebase_uid, name, email, role, department) 
         VALUES (?, ?, ?, 'APPLICANT', 'General')`,
        [uid, name || email.split('@')[0], email]
      );
      
      const [newUsers] = await pool.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
      user = newUsers[0];
    } else {
      user = users[0];
    }

    res.json({ success: true, user });

  } catch (error) {
    console.error('Auth Sync Error:', error.message);
    res.status(403).json({ success: false, message: 'Invalid or expired token.' });
  }
};