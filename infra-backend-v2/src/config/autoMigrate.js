import pool from './db.js';

/**
 * Idempotent Database Auto-Migration Runner
 * Guarantees that any deployed server (Docker, cloud VM, bare metal, staging, production)
 * has all required tables, columns, indexes, and ENUM values synchronized without manual intervention.
 */
export async function runAutoMigrations() {
  console.log('🔄 Checking database schema integrity and applying auto-migrations...');

  let connection;
  try {
    connection = await pool.getConnection();

    // 1. Verify and add 'title' column to tickets table
    const [titleCol] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'tickets' 
        AND COLUMN_NAME = 'title'
    `);

    if (titleCol.length === 0) {
      console.log('📦 Migrating: Adding missing "title" column to tickets table...');
      await connection.query(`
        ALTER TABLE tickets 
        ADD COLUMN title VARCHAR(255) NULL AFTER department
      `);
      console.log('✅ Added "title" column to tickets table.');
    }

    // 2. Verify tickets.status column includes modern workflow statuses
    const [statusCol] = await connection.query(`
      SELECT COLUMN_TYPE 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'tickets' 
        AND COLUMN_NAME = 'status'
    `);

    if (statusCol.length > 0) {
      const typeStr = String(statusCol[0].COLUMN_TYPE);
      if (!typeStr.includes('TENDER_PUBLISHED') || !typeStr.includes('WORK_IN_PROGRESS')) {
        console.log('📦 Migrating: Updating tickets.status ENUM with tendering milestones...');
        await connection.query(`
          ALTER TABLE tickets 
          MODIFY COLUMN status ENUM(
            'ASSIGNED_TO_JE','PENDING_AE_APPROVAL','PENDING_SE_APPROVAL',
            'PENDING_DEAN_APPROVAL','PENDING_DIRECTOR_APPROVAL','APPROVED_FOR_TENDERING',
            'TENDER_PUBLISHED','WORK_IN_PROGRESS',
            'RETURNED_TO_JE','DENIED','CLOSED'
          ) NOT NULL DEFAULT 'ASSIGNED_TO_JE'
        `);
        console.log('✅ Updated tickets.status ENUM.');
      }
    }

    // 3. Verify users.role column includes 'ACCOUNTANT', 'CLERICAL', 'SYSADMIN'
    const [roleCol] = await connection.query(`
      SELECT COLUMN_TYPE 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'users' 
        AND COLUMN_NAME = 'role'
    `);

    if (roleCol.length > 0) {
      const roleStr = String(roleCol[0].COLUMN_TYPE);
      if (!roleStr.includes('ACCOUNTANT') || !roleStr.includes('CLERICAL') || !roleStr.includes('SYSADMIN')) {
        console.log('📦 Migrating: Updating users.role ENUM to include ACCOUNTANT, CLERICAL, SYSADMIN...');
        await connection.query(`
          ALTER TABLE users 
          MODIFY COLUMN role ENUM(
            'APPLICANT', 'JE', 'AE', 'SE', 'DEAN', 'DIRECTOR', 'SYSADMIN', 'CLERICAL', 'ACCOUNTANT'
          ) NOT NULL
        `);
        console.log('✅ Updated users.role ENUM.');
      }
    }

    // 4. Verify and create tenders table
    const [tendersTable] = await connection.query(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'tenders'
    `);

    if (tendersTable.length === 0) {
      console.log('📦 Migrating: Creating missing "tenders" table...');
      await connection.query(`
        CREATE TABLE tenders (
          id INT AUTO_INCREMENT PRIMARY KEY,
          ticket_id INT NOT NULL,
          nit_number VARCHAR(100) NOT NULL,
          portal_type VARCHAR(50) DEFAULT 'GeM',
          published_date DATE,
          bid_opening_date DATE,
          awarded_agency VARCHAR(255),
          work_order_value DECIMAL(12, 2),
          status ENUM('PUBLISHED','EVALUATION','AWARDED','CANCELLED') DEFAULT 'PUBLISHED',
          remarks TEXT,
          created_by INT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
          FOREIGN KEY (created_by) REFERENCES users(id),
          INDEX idx_tender_ticket (ticket_id),
          INDEX idx_tender_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('✅ Created "tenders" table.');
    }

    // 5. Verify and create bills table
    const [billsTable] = await connection.query(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'bills'
    `);

    if (billsTable.length === 0) {
      console.log('📦 Migrating: Creating missing "bills" table...');
      await connection.query(`
        CREATE TABLE bills (
          id INT AUTO_INCREMENT PRIMARY KEY,
          ticket_id INT NOT NULL,
          bill_number VARCHAR(100) NOT NULL,
          voucher_number VARCHAR(100),
          agency_name VARCHAR(255) NOT NULL,
          bill_type ENUM('RA_BILL','FINAL_BILL','ADVANCE','SECURITY_REFUND') DEFAULT 'RA_BILL',
          gross_amount DECIMAL(12, 2) NOT NULL,
          deductions DECIMAL(12, 2) DEFAULT 0.00,
          net_amount DECIMAL(12, 2) NOT NULL,
          payment_status ENUM('PENDING','VERIFIED','DISBURSED','REJECTED') DEFAULT 'PENDING',
          payment_date DATE,
          payment_mode VARCHAR(50) DEFAULT 'PFMS',
          remarks TEXT,
          processed_by INT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
          FOREIGN KEY (processed_by) REFERENCES users(id),
          INDEX idx_bill_ticket (ticket_id),
          INDEX idx_bill_status (payment_status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('✅ Created "bills" table.');
    }

    console.log('✨ Database schema verification and auto-migrations complete.');
  } catch (err) {
    console.error('⚠️ Auto-migration check warning:', err.message);
  } finally {
    if (connection) connection.release();
  }
}
