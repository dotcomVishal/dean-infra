import pool from '../config/db.js';
import { sendEmail } from '../utils/mailer.js';

export const createTicket = async (req, res) => {
  const applicant_id = req.user.id; 
  const { department, description, location, type = 'recurring' } = req.body;

  if (type === 'non-recurring' && req.user.role !== 'JE') {
    return res.status(403).json({ success: false, message: 'Only JEs can initiate non-recurring work.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [jes] = await connection.query(`
      SELECT u.id, u.email, COUNT(t.id) as active_tickets
      FROM users u
      LEFT JOIN tickets t ON u.id = t.assigned_je_id AND t.status NOT IN ('CLOSED', 'DENIED')
      WHERE u.role = 'JE' AND u.department = ?
      GROUP BY u.id
      ORDER BY active_tickets ASC
      LIMIT 1
    `, [department]);

    if (jes.length === 0) throw new Error(`No JE available for the ${department} department`);
    const assigned_je = jes[0];

    const [ticketResult] = await connection.query(
      `INSERT INTO tickets (applicant_id, assigned_je_id, department, type, description, location, status) 
       VALUES (?, ?, ?, ?, ?, ?, 'ASSIGNED_TO_JE')`,
      [applicant_id, assigned_je.id, department, type, description, location]
    );
    
    const ticket_id = ticketResult.insertId;

    // --- FIX: SAVE THE ATTACHMENTS TO THE DATABASE ---
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
    // -------------------------------------------------

    await connection.commit();

    sendEmail(
      assigned_je.email, 
      'New Ticket Assigned', 
      `You have been assigned Ticket #${ticket_id}. Please log into the portal to review the location.`
    );

    res.json({ success: true, ticket_id, assigned_je_id: assigned_je.id });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ success: false, message: error.message });
  } finally {
    connection.release();
  }
};


// PAGINATION: Get Authority Queue
export const getQueue = async (req, res) => {
  const { role, department } = req.user;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;

  let query = '';
  let queryParams = [];

  if (role === 'DIRECTOR') {
    query = `SELECT * FROM tickets ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    queryParams = [limit, offset];
  } 
  // ... (You can expand AE/SE/DEAN queries here later)
  
  try {
    const [tickets] = await pool.query(query, queryParams);
    res.json({ success: true, page, limit, tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// TENDERING & CLOSURE: Manual milestones updated by the JE
export const updateTenderStatus = async (req, res) => {
  const { ticket_id } = req.params;
  const { milestone } = req.body; 

  try {
    await pool.query(
      `UPDATE tickets SET status = ? WHERE id = ? AND assigned_je_id = ?`,
      [milestone, ticket_id, req.user.id]
    );
    res.json({ success: true, message: `Ticket updated to ${milestone}` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};