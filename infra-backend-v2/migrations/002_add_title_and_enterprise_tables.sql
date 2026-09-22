-- ============================================================
-- Migration 002 — Add Title to Tickets, Modern Statuses & Tenders/Bills Tables
--
-- Run with:
--   mysql -u root -p deanery_infra < migrations/002_add_title_and_enterprise_tables.sql
-- ============================================================

USE deanery_infra;

-- 1. Add title column to tickets if it does not already exist
SET @dbname = DATABASE();
SET @tablename = "tickets";
SET @columnname = "title";
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (TABLE_SCHEMA = @dbname)
      AND (TABLE_NAME = @tablename)
      AND (COLUMN_NAME = @columnname)
  ) > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD COLUMN title VARCHAR(255) NULL AFTER department"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 1b. Add document_category to attachments if missing
SET @tablename = "attachments";
SET @columnname = "document_category";
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (TABLE_SCHEMA = @dbname)
      AND (TABLE_NAME = @tablename)
      AND (COLUMN_NAME = @columnname)
  ) > 0,
  "SELECT 1",
  "ALTER TABLE attachments ADD COLUMN document_category ENUM('APPLICANT_EVIDENCE','JE_SITE_PHOTO','JE_ESTIMATE_DOC','CLERK_TENDER_DOC','FINANCE_SANCTION','AUTHORITY_REMARKS') NOT NULL DEFAULT 'APPLICANT_EVIDENCE'"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 2. Update tickets.status ENUM
ALTER TABLE tickets 
MODIFY COLUMN status ENUM(
  'ASSIGNED_TO_JE','PENDING_AE_APPROVAL','PENDING_SE_APPROVAL',
  'PENDING_DEAN_APPROVAL','PENDING_DIRECTOR_APPROVAL','APPROVED_FOR_TENDERING',
  'TENDER_PUBLISHED','WORK_IN_PROGRESS',
  'RETURNED_TO_JE','DENIED','CLOSED'
) NOT NULL DEFAULT 'ASSIGNED_TO_JE';

-- 3. Update users.role ENUM
ALTER TABLE users 
MODIFY COLUMN role ENUM(
  'APPLICANT', 'JE', 'AE', 'SE', 'DEAN', 'DIRECTOR', 'SYSADMIN', 'CLERICAL', 'ACCOUNTANT'
) NOT NULL;

-- 4. Create tenders table if not exists
CREATE TABLE IF NOT EXISTS tenders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT NOT NULL,
  nit_number VARCHAR(100) NOT NULL UNIQUE,
  gem_bid_number VARCHAR(100),
  portal_type ENUM('GEM', 'CPP', 'OFFLINE') DEFAULT 'GEM',
  estimated_amount DECIMAL(12, 2) NOT NULL,
  nit_published_date DATE NOT NULL,
  bid_opening_date DATE,
  status ENUM('NIT_PREPARED', 'PUBLISHED', 'TECHNICAL_EVALUATION', 'FINANCIAL_EVALUATION', 'AWARDED', 'CANCELLED', 'RETENDERED') DEFAULT 'NIT_PREPARED',
  awarded_agency VARCHAR(255),
  work_order_number VARCHAR(100),
  work_order_value DECIMAL(12, 2),
  work_order_date DATE,
  stipulated_completion_date DATE,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_tender_ticket (ticket_id),
  INDEX idx_tender_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Create bills table if not exists
CREATE TABLE IF NOT EXISTS bills (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT NOT NULL,
  tender_id INT,
  bill_number VARCHAR(100) NOT NULL,
  bill_type ENUM('RA_BILL', 'FINAL_BILL', 'ADVANCE') NOT NULL,
  agency_name VARCHAR(255) NOT NULL,
  gross_amount DECIMAL(12, 2) NOT NULL,
  gst_deduction DECIMAL(10, 2) DEFAULT 0.00,
  tds_deduction DECIMAL(10, 2) DEFAULT 0.00,
  sd_deduction DECIMAL(10, 2) DEFAULT 0.00,
  other_deductions DECIMAL(10, 2) DEFAULT 0.00,
  net_amount DECIMAL(12, 2) NOT NULL,
  payment_mode ENUM('PFMS', 'RTGS', 'CHEQUE') DEFAULT 'PFMS',
  voucher_number VARCHAR(100),
  disbursed_at DATETIME,
  payment_status ENUM('PENDING_AUDIT', 'PASSED', 'DISBURSED', 'REJECTED') DEFAULT 'PENDING_AUDIT',
  accountant_id INT,
  remarks TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (tender_id) REFERENCES tenders(id) ON DELETE SET NULL,
  FOREIGN KEY (accountant_id) REFERENCES users(id),
  INDEX idx_bill_ticket (ticket_id),
  INDEX idx_bill_status (payment_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
