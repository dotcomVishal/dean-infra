import express from 'express';
import pool from '../db.js';
import { upload } from '../middleware/upload.js';

const router = express.Router();

// 1. Raise a Ticket & Auto-Assign JE (POST /api/tickets)
router.post('/', upload.array('files', 5), async (req, res) => {
  const { applicant_id, department, description, location, type = 'recurring' } = req.body;

  if (!applicant_id || !department || !description) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [jes] = await connection.query(
      'SELECT id FROM users WHERE role = "JE" AND department = ? ORDER BY RAND() LIMIT 1',
      [department]
    );

    if (jes.length === 0) {
      throw new Error(`No Junior Engineer available for the ${department} department.`);
    }
    const assigned_je_id = jes[0].id;

    const [ticketResult] = await connection.query(
      `INSERT INTO tickets (applicant_id, assigned_je_id, department, type, description, location, status) 
       VALUES (?, ?, ?, ?, ?, ?, 'ASSIGNED_TO_JE')`,
      [applicant_id, assigned_je_id, department, type, description, location]
    );
    const ticket_id = ticketResult.insertId;

    if (req.files && req.files.length > 0) {
      const attachmentQueries = req.files.map(file => {
        const fileUrl = `/uploads/${file.filename}`;
        return connection.query(
          'INSERT INTO attachments (ticket_id, file_url, uploaded_by) VALUES (?, ?, ?)',
          [ticket_id, fileUrl, applicant_id]
        );
      });
      await Promise.all(attachmentQueries);
    }

    await connection.commit();
    res.json({ success: true, message: 'Ticket raised successfully', ticket_id, assigned_je_id, status: 'ASSIGNED_TO_JE' });

  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    connection.release();
  }
});

// 2. JE Dashboard (GET /api/tickets/je/:je_id)
router.get('/je/:je_id', async (req, res) => {
  const { je_id } = req.params;
  try {
    const [tickets] = await pool.query(
      `SELECT t.*, u.name as applicant_name, u.phone as applicant_phone 
       FROM tickets t JOIN users u ON t.applicant_id = u.id 
       WHERE t.assigned_je_id = ? ORDER BY t.created_at DESC`,
      [je_id]
    );
    res.json({ success: true, tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. JE Submits Inspection Report & Estimate (POST /api/tickets/:ticket_id/report)
router.post('/:ticket_id/report', upload.array('files', 5), async (req, res) => {
  const { ticket_id } = req.params;
  const { je_id, nature_of_work, estimated_amount } = req.body;

  if (!je_id || !nature_of_work || !estimated_amount) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.query(
      `INSERT INTO reports (ticket_id, je_id, nature_of_work, estimated_amount) VALUES (?, ?, ?, ?)`,
      [ticket_id, je_id, nature_of_work, estimated_amount]
    );

    await connection.query(
      `UPDATE tickets SET status = 'PENDING_AE_APPROVAL' WHERE id = ?`,
      [ticket_id]
    );

    if (req.files && req.files.length > 0) {
      const attachmentQueries = req.files.map(file => {
        const fileUrl = `/uploads/${file.filename}`;
        return connection.query(
          'INSERT INTO attachments (ticket_id, file_url, uploaded_by) VALUES (?, ?, ?)',
          [ticket_id, fileUrl, je_id]
        );
      });
      await Promise.all(attachmentQueries);
    }

    await connection.commit();
    res.json({ success: true, message: 'Report submitted and forwarded to AE' });

  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    connection.release();
  }
});

// 4. Hierarchical Review Route (AE, SE, Dean, Director)
router.post('/:ticket_id/review', async (req, res) => {
  const { ticket_id } = req.params;
  const { user_id, action, remarks } = req.body; // action: 'APPROVE' or 'RETURN' or 'DENY'

  if (!user_id || !action) {
    return res.status(400).json({ success: false, message: 'Missing user_id or action' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Get user role
    const [users] = await connection.query('SELECT role FROM users WHERE id = ?', [user_id]);
    if (users.length === 0) throw new Error('User not found');
    const role = users[0].role;

    // Get ticket and its estimated amount from the report
    const [tickets] = await connection.query(
      `SELECT t.status, r.estimated_amount 
       FROM tickets t 
       LEFT JOIN reports r ON t.id = r.ticket_id 
       WHERE t.id = ? ORDER BY r.created_at DESC LIMIT 1`,
      [ticket_id]
    );
    if (tickets.length === 0) throw new Error('Ticket not found');
    
    const estimate = parseFloat(tickets[0].estimated_amount);
    let nextStatus = '';
    let logAction = '';

    // Handle Returns / Denials
    if (action === 'RETURN') {
      nextStatus = 'RETURNED_TO_JE'; // Sends it back down for revision
      logAction = 'RETURNED';
    } else if (action === 'DENY' && role === 'DIRECTOR') {
      nextStatus = 'DENIED'; // Only Director can completely deny
      logAction = 'DENIED';
    } 
    // Handle Approvals based on thresholds
    else if (action === 'APPROVE') {
      if (role === 'AE') {
        nextStatus = 'PENDING_SE_APPROVAL';
        logAction = 'PASSED';
      } 
      else if (role === 'SE') {
        if (estimate <= 50000) {
          nextStatus = 'APPROVED_FOR_TENDERING';
          logAction = 'APPROVED';
        } else {
          nextStatus = 'PENDING_DEAN_APPROVAL';
          logAction = 'PASSED';
        }
      } 
      else if (role === 'DEAN') {
        if (estimate <= 500000) {
          nextStatus = 'APPROVED_FOR_TENDERING';
          logAction = 'APPROVED';
        } else {
          nextStatus = 'PENDING_DIRECTOR_APPROVAL';
          logAction = 'PASSED';
        }
      } 
      else if (role === 'DIRECTOR') {
        nextStatus = 'APPROVED_FOR_TENDERING';
        logAction = 'APPROVED';
      } else {
        throw new Error('Unauthorized role for approval');
      }
    } else {
      throw new Error('Invalid action');
    }

    // Update Ticket Status
    await connection.query('UPDATE tickets SET status = ? WHERE id = ?', [nextStatus, ticket_id]);

    // Insert Audit Log
    await connection.query(
      'INSERT INTO audit_logs (ticket_id, user_id, action, remarks) VALUES (?, ?, ?, ?)',
      [ticket_id, user_id, logAction, remarks || '']
    );

    await connection.commit();
    res.json({ success: true, message: `Ticket status updated to ${nextStatus}` });

  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    connection.release();
  }
});

// 5. Authority Dashboard Queue (AE, SE, Dean, Director)
router.get('/queue/:user_id', async (req, res) => {
  const { user_id } = req.params;

  try {
    const [users] = await pool.query('SELECT role, department FROM users WHERE id = ?', [user_id]);
    if (users.length === 0) return res.status(404).json({ success: false, message: 'User not found' });
    
    const user = users[0];
    let query = '';
    let queryParams = [];

    // Build the query based on hierarchical visibility
    if (user.role === 'AE') {
      query = `SELECT t.*, r.estimated_amount FROM tickets t 
               LEFT JOIN reports r ON t.id = r.ticket_id 
               WHERE t.status = 'PENDING_AE_APPROVAL' AND t.department = ?`;
      queryParams = [user.department];
    } else if (user.role === 'SE') {
      query = `SELECT t.*, r.estimated_amount FROM tickets t 
               LEFT JOIN reports r ON t.id = r.ticket_id 
               WHERE t.status = 'PENDING_SE_APPROVAL'`;
    } else if (user.role === 'DEAN') {
      query = `SELECT t.*, r.estimated_amount FROM tickets t 
               LEFT JOIN reports r ON t.id = r.ticket_id 
               WHERE t.status = 'PENDING_DEAN_APPROVAL'`;
    } else if (user.role === 'DIRECTOR') {
      // Director God Mode: Sees all tickets across the system
      query = `SELECT t.*, r.estimated_amount FROM tickets t 
               LEFT JOIN reports r ON t.id = r.ticket_id 
               ORDER BY t.created_at DESC`;
    } else {
      return res.status(403).json({ success: false, message: 'Unauthorized role for this dashboard' });
    }

    const [tickets] = await pool.query(query, queryParams);
    res.json({ success: true, tickets });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
});


// 6. Get Full Ticket Details & Enforce Visibility
router.get('/:ticket_id/details/:user_id', async (req, res) => {
  const { ticket_id, user_id } = req.params;

  try {
    const [users] = await pool.query('SELECT role FROM users WHERE id = ?', [user_id]);
    if (users.length === 0) return res.status(404).json({ success: false, message: 'User not found' });
    const userRole = users[0].role;

    // 1. Fetch Ticket & Applicant Info
    const [tickets] = await pool.query(
      `SELECT t.*, u.name as applicant_name FROM tickets t 
       JOIN users u ON t.applicant_id = u.id WHERE t.id = ?`, [ticket_id]
    );
    if (tickets.length === 0) return res.status(404).json({ success: false, message: 'Ticket not found' });
    const ticketData = tickets[0];

    // 2. Fetch JE Report
    const [reports] = await pool.query('SELECT * FROM reports WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1', [ticket_id]);
    ticketData.report = reports.length > 0 ? reports[0] : null;

    // 3. Fetch Attachments
    const [attachments] = await pool.query('SELECT file_url, uploaded_by, created_at FROM attachments WHERE ticket_id = ?', [ticket_id]);
    ticketData.attachments = attachments;

    // 4. Fetch Audit Logs (ONLY if authority role)
    const authorityRoles = ['AE', 'SE', 'DEAN', 'DIRECTOR', 'SYSADMIN'];
    if (authorityRoles.includes(userRole)) {
      const [logs] = await pool.query(
        `SELECT a.action, a.remarks, a.created_at, u.name as actor_name, u.role as actor_role 
         FROM audit_logs a JOIN users u ON a.user_id = u.id 
         WHERE a.ticket_id = ? ORDER BY a.created_at ASC`, [ticket_id]
      );
      ticketData.audit_logs = logs;
    } else {
      // JE and Applicant cannot see internal remarks
      ticketData.audit_logs = []; 
    }

    res.json({ success: true, ticket: ticketData });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
});


export default router;