CREATE DATABASE IF NOT EXISTS deanery_infra;
USE deanery_infra;

-- Users table supporting all system roles
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    role ENUM(
        'APPLICANT',
        'JE',
        'AE',
        'SE',
        'DEAN',
        'DIRECTOR',
        'SYSADMIN'
    ) NOT NULL,
    department ENUM('Civil', 'Electrical', 'Horticulture', 'Administration', 'General') NOT NULL,
    phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table for Tickets
CREATE TABLE IF NOT EXISTS tickets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    applicant_id INT NOT NULL,
    assigned_je_id INT,
    department ENUM('Civil', 'Electrical', 'Horticulture') NOT NULL,
    type ENUM('recurring', 'non-recurring') DEFAULT 'recurring',
    description TEXT NOT NULL,
    location VARCHAR(255),
    status VARCHAR(50) DEFAULT 'ASSIGNED_TO_JE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (applicant_id) REFERENCES users(id),
    FOREIGN KEY (assigned_je_id) REFERENCES users(id)
);

-- Table for Attachments (links files to tickets)
CREATE TABLE IF NOT EXISTS attachments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT NOT NULL,
    file_url VARCHAR(255) NOT NULL,
    uploaded_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

-- Seed dummy accounts for testing
INSERT INTO users (name, email, role, department, phone) VALUES
('Rohan Verma (Applicant)', 'applicant@campus.edu', 'APPLICANT', 'General', '9876543210'),
('Amit Kumar (JE Civil)', 'je.civil@campus.edu', 'JE', 'Civil', '9876543211'),
('Priya Singh (AE Civil)', 'ae.civil@campus.edu', 'AE', 'Civil', '9876543212'),
('Rajesh Sharma (SE)', 'se@campus.edu', 'SE', 'Administration', '9876543213'),
('Prof. K. N. Rao (Dean Infra)', 'dean.infra@campus.edu', 'DEAN', 'Administration', '9876543214'),
('Dr. S. K. Mehta (Director)', 'director@campus.edu', 'DIRECTOR', 'Administration', '9876543215'),
('Vikas Admin (SysAdmin)', 'sysadmin@campus.edu', 'SYSADMIN', 'Administration', '9876543216')
ON DUPLICATE KEY UPDATE name=VALUES(name);