CREATE DATABASE IF NOT EXISTS deanery_infra;
USE deanery_infra;

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    firebase_uid VARCHAR(128) UNIQUE NOT NULL, -- Security: Replaces passwords/payload spoofing[cite: 2]
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    role ENUM('APPLICANT', 'JE', 'AE', 'SE', 'DEAN', 'DIRECTOR', 'SYSADMIN', 'CLERICAL') NOT NULL,
    department ENUM('Civil', 'Electrical', 'Horticulture', 'Administration', 'General') NOT NULL,
    phone VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Efficiency: Instantly find available JEs by department[cite: 2]
    INDEX idx_role_dept (role, department) 
);

-- 2. TICKETS TABLE
CREATE TABLE IF NOT EXISTS tickets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    applicant_id INT NOT NULL,
    assigned_je_id INT,
    department ENUM('Civil', 'Electrical', 'Horticulture') NOT NULL,
    title VARCHAR(255) NULL,
    type ENUM('recurring', 'non-recurring') DEFAULT 'recurring',
    description TEXT NOT NULL,
    location VARCHAR(255),
    status ENUM(
        'ASSIGNED_TO_JE','PENDING_AE_APPROVAL','PENDING_SE_APPROVAL',
        'PENDING_DEAN_APPROVAL','PENDING_DIRECTOR_APPROVAL','APPROVED_FOR_TENDERING',
        'TENDER_PUBLISHED','WORK_IN_PROGRESS',
        'RETURNED_TO_JE','DENIED','CLOSED'
    ) NOT NULL DEFAULT 'ASSIGNED_TO_JE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (applicant_id) REFERENCES users(id),
    FOREIGN KEY (assigned_je_id) REFERENCES users(id),
    -- Efficiency: Composite index for Authority Dashboards querying by status and department[cite: 2]
    INDEX idx_status_dept_date (status, department, created_at),
    INDEX idx_assigned_je (assigned_je_id)
);

-- 3. REPORTS TABLE
CREATE TABLE IF NOT EXISTS reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT NOT NULL,
    je_id INT NOT NULL,
    nature_of_work TEXT NOT NULL,
    estimated_amount DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
    FOREIGN KEY (je_id) REFERENCES users(id),
    INDEX idx_ticket (ticket_id)
);

-- 4. ATTACHMENTS TABLE
CREATE TABLE IF NOT EXISTS attachments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT NOT NULL,
    file_url VARCHAR(255) NOT NULL,
    uploaded_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    document_category ENUM('APPLICANT_EVIDENCE','JE_SITE_PHOTO','JE_ESTIMATE_DOC','CLERK_TENDER_DOC','FINANCE_SANCTION','AUTHORITY_REMARKS') NOT NULL DEFAULT 'APPLICANT_EVIDENCE',
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES users(id),
    INDEX idx_ticket (ticket_id)
);

-- 5. AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT NOT NULL,
    user_id INT NOT NULL,
    action ENUM('CREATED', 'ASSIGNED', 'SUBMITTED', 'PASSED', 'APPROVED', 'RETURNED', 'DENIED') NOT NULL,
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    -- Crucial for generating the history timeline that the Director sees instantly[cite: 3]
    INDEX idx_ticket_timeline (ticket_id, created_at)
);

INSERT INTO users (firebase_uid, name, email, role, department, phone) VALUES
-- The Top Brass & Admins
('mock_uid_01', 'Dr. S. K. Mehta', 'director@campus.edu', 'DIRECTOR', 'Administration', '9876543001'),
('mock_uid_02', 'Prof. K. N. Rao', 'dean.infra@campus.edu', 'DEAN', 'Administration', '9876543002'),
('mock_uid_03', 'Vikas Admin', 'sysadmin@campus.edu', 'SYSADMIN', 'Administration', '9876543003'),

-- The Superintending Engineers (SE)
('mock_uid_04', 'Rajesh Sharma', 'se.civil@campus.edu', 'SE', 'Civil', '9876543004'),
('mock_uid_05', 'Meera Reddy', 'se.electrical@campus.edu', 'SE', 'Electrical', '9876543005'),

-- The Assistant Engineers (AE)
('mock_uid_06', 'Priya Singh', 'ae.civil@campus.edu', 'AE', 'Civil', '9876543006'),
('mock_uid_07', 'Vikram Malhotra', 'ae.electrical@campus.edu', 'AE', 'Electrical', '9876543007'),
('mock_uid_08', 'Neha Gupta', 'ae.horticulture@campus.edu', 'AE', 'Horticulture', '9876543008'),

-- The Junior Engineers (JE)
('mock_uid_09', 'Amit Kumar', 'je.civil1@campus.edu', 'JE', 'Civil', '9876543009'),
('mock_uid_10', 'Suresh Menon', 'je.civil2@campus.edu', 'JE', 'Civil', '9876543010'),
('mock_uid_11', 'Rahul Desai', 'je.electrical1@campus.edu', 'JE', 'Electrical', '9876543011'),
('mock_uid_12', 'Kavita Reddy', 'je.electrical2@campus.edu', 'JE', 'Electrical', '9876543012'),
('mock_uid_13', 'Sneha Patel', 'je.horticulture1@campus.edu', 'JE', 'Horticulture', '9876543013'),
('mock_uid_14', 'Arjun Das', 'je.horticulture2@campus.edu', 'JE', 'Horticulture', '9876543014'),

-- Clerical & Account Staff
('mock_uid_15', 'Jyoti Singh', 'accountant1@campus.edu', 'ACCOUNTANT', 'Administration', '9876543015'),
('mock_uid_16', 'Ramesh Kumar', 'accountant2@campus.edu', 'ACCOUNTANT', 'Administration', '9876543016'),
('mock_uid_17', 'Pooja Sharma', 'clerical1@campus.edu', 'CLERICAL', 'Administration', '9876543017'),
('mock_uid_18', 'Anil Kapoor', 'clerical2@campus.edu', 'CLERICAL', 'Administration', '9876543018'),

-- General Applicants
('mock_uid_19', 'Rohan Verma', 'applicant1@campus.edu', 'APPLICANT', 'General', '9876543019'),
('mock_uid_20', 'Aditi Rao', 'applicant2@campus.edu', 'APPLICANT', 'General', '9876543020');
