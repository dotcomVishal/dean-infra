import pool from '../config/db.js';
import { sendEmail } from '../utils/mailer.js';
import { organizeTicketFiles, cleanupTempFiles } from '../utils/fileManager.js';

// 1. APPLICANT & JE (Non-Recurring): Create Ticket
export const createTicket = async (req, res) => {
  const applicant_id = req.user.id; 
  const { department, description, location, type = 'recurring' } = req.body;

  if (type === 'non-recurring' && req.user.role !== 'JE') {
    cleanupTempFiles(req.files);
    return res.status(403).json({ success: false, message: 'Only JEs can initiate non-recurring work.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Fair Auto-Assignment Engine
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

    // SECURE FILE ROUTING: Staging -> Permanent
    if (req.files && req.files.length > 0) {
      const finalFileUrls = organizeTicketFiles(req.files, ticket_id, 'applicant_evidence');
      
      const attachmentQueries = finalFileUrls.map(url => {
        return connection.query(
          'INSERT INTO attachments (ticket_id, file_url, uploaded_by) VALUES (?, ?, ?)',
          [ticket_id, url, applicant_id]
        );
      });
      await Promise.all(attachmentQueries);
    }

    await connection.commit();

    sendEmail(assigned_je.email, 'New Ticket Assigned', `You have been assigned Ticket #${ticket_id}.`);
    res.json({ success: true, ticket_id, assigned_je_id: assigned_je.id });

  } catch (error) {
    await connection.rollback();
    cleanupTempFiles(req.files); 
    res.status(500).json({ success: false, message: error.message });
  } finally {
    connection.release();
  }
};

// 2. JE: Submits Inspection Report (Handles BOTH Photos and Estimate Docs)
export const submitJeReport = async (req, res) => {
  const je_id = req.user.id;
  const { ticket_id } = req.params;
  const { nature_of_work, estimated_amount } = req.body;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Validate ticket belongs to this JE
    const [ticket] = await connection.query('SELECT id FROM tickets WHERE id = ? AND assigned_je_id = ?', [ticket_id, je_id]);
    if (ticket.length === 0) throw new Error('Unauthorized or Ticket not found');

    // Insert Text Report
    await connection.query(
      `INSERT INTO reports (ticket_id, je_id, nature_of_work, estimated_amount) VALUES (?, ?, ?, ?)`,
      [ticket_id, je_id, nature_of_work, estimated_amount]
    );
    await connection.query(`UPDATE tickets SET status = 'PENDING_AE_APPROVAL' WHERE id = ?`, [ticket_id]);

    // Route JE Site Photos
    if (req.files && req.files['site_photos']) {
      const photoUrls = organizeTicketFiles(req.files['site_photos'], ticket_id, 'je_inspection/photos');
      const queries = photoUrls.map(url => connection.query(
        'INSERT INTO attachments (ticket_id, file_url, uploaded_by, document_category) VALUES (?, ?, ?, "JE_SITE_PHOTO")',
        [ticket_id, url, je_id]
      ));
      await Promise.all(queries);
    }

    // Route JE Budget/Estimate Documents
    if (req.files && req.files['estimate_docs']) {
      const docUrls = organizeTicketFiles(req.files['estimate_docs'], ticket_id, 'je_inspection/estimates');
      const queries = docUrls.map(url => connection.query(
        'INSERT INTO attachments (ticket_id, file_url, uploaded_by, document_category) VALUES (?, ?, ?, "JE_ESTIMATE_DOC")',
        [ticket_id, url, je_id]
      ));
      await Promise.all(queries);
    }

    await connection.commit();
    res.json({ success: true, message: 'Report and all files submitted successfully.' });
  } catch (error) {
    await connection.rollback();
    cleanupTempFiles(req.files);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    connection.release();
  }
};

// 3. CLERICAL STAFF: Upload Tendering Documents (CPP / GEM / NIT)
export const uploadClerkDocs = async (req, res) => {
  const clerk_id = req.user.id;
  const { ticket_id } = req.params;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    if (req.files && req.files.length > 0) {
      const tenderUrls = organizeTicketFiles(req.files, ticket_id, 'tendering_docs');
      const queries = tenderUrls.map(url => connection.query(
        'INSERT INTO attachments (ticket_id, file_url, uploaded_by, document_category) VALUES (?, ?, ?, "CLERK_TENDER_DOC")',
        [ticket_id, url, clerk_id]
      ));
      await Promise.all(queries);
    }

    await connection.commit();
    res.json({ success: true, message: 'Tender documents securely attached.' });
  } catch (error) {
    await connection.rollback();
    cleanupTempFiles(req.files);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    connection.release();
  }
};

// 4. ACCOUNTANT: Upload Financial Sanctions
export const uploadBudgetDocs = async (req, res) => {
  const accountant_id = req.user.id;
  const { ticket_id } = req.params;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    if (req.files && req.files.length > 0) {
      const budgetUrls = organizeTicketFiles(req.files, ticket_id, 'financial_sanctions');
      const queries = budgetUrls.map(url => connection.query(
        'INSERT INTO attachments (ticket_id, file_url, uploaded_by, document_category) VALUES (?, ?, ?, "FINANCE_SANCTION")',
        [ticket_id, url, accountant_id]
      ));
      await Promise.all(queries);
    }

    await connection.commit();
    res.json({ success: true, message: 'Budget sanctions securely attached.' });
  } catch (error) {
    await connection.rollback();
    cleanupTempFiles(req.files);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    connection.release();
  }
};

// 5. CLERICAL & JE: Manual milestones (Tendering)
export const updateTenderStatus = async (req, res) => {
  const { ticket_id } = req.params;
  const { milestone } = req.body; 

  try {
    await pool.query(
      `UPDATE tickets SET status = ? WHERE id = ?`,
      [milestone, ticket_id]
    );
    res.json({ success: true, message: `Ticket updated to ${milestone}` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 6. ALL AUTHORITIES: Fetch Paginated Queues
export const getQueue = async (req, res) => {
  const { role, department } = req.user;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;

  let query = '';
  let queryParams = [];

  // Centralized Queue Router
  if (role === 'DIRECTOR' || role === 'SYSADMIN' || role === 'ACCOUNTANT' || role === 'CLERICAL') {
    query = `SELECT t.*, r.estimated_amount FROM tickets t LEFT JOIN reports r ON t.id = r.ticket_id ORDER BY t.created_at DESC LIMIT ? OFFSET ?`;
    queryParams = [limit, offset];
  } else if (role === 'DEAN') {
    query = `SELECT t.*, r.estimated_amount FROM tickets t LEFT JOIN reports r ON t.id = r.ticket_id WHERE t.status = 'PENDING_DEAN_APPROVAL' ORDER BY t.created_at ASC LIMIT ? OFFSET ?`;
    queryParams = [limit, offset];
  } else if (role === 'SE') {
    query = `SELECT t.*, r.estimated_amount FROM tickets t LEFT JOIN reports r ON t.id = r.ticket_id WHERE t.status = 'PENDING_SE_APPROVAL' ORDER BY t.created_at ASC LIMIT ? OFFSET ?`;
    queryParams = [limit, offset];
  } else if (role === 'AE') {
    query = `SELECT t.*, r.estimated_amount FROM tickets t LEFT JOIN reports r ON t.id = r.ticket_id WHERE t.status = 'PENDING_AE_APPROVAL' AND t.department = ? ORDER BY t.created_at ASC LIMIT ? OFFSET ?`;
    queryParams = [department, limit, offset];
  }
  
  try {
    const [tickets] = await pool.query(query, queryParams);
    res.json({ success: true, page, limit, tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};