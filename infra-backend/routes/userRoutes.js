import express from 'express';
import pool from '../db.js';

const router = express.Router();

// GET /api/users
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, email, role, department, phone FROM users');
    res.json({ success: true, users: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;