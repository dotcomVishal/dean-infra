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
    type ENUM('recurring', 'non-recurring') DEFAULT 'recurring',
    description TEXT NOT NULL,
    location VARCHAR(255),
    status ENUM(
        'ASSIGNED_TO_JE','PENDING_AE_APPROVAL','PENDING_SE_APPROVAL',
        'PENDING_DEAN_APPROVAL','PENDING_DIRECTOR_APPROVAL','APPROVED_FOR_TENDERING',
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