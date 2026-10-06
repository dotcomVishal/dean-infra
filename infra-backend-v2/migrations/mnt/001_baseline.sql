-- ============================================================
-- Baseline schema for the maintenance module (prefix mnt_).
-- Replaces schema.sql + legacy migrations 001-015 (kept in migrations/legacy/,
-- never run). Generated from the tested schema, then reviewed.
-- No USE, no database name: the connection decides the database.
-- Tables are in dependency order; foreign key checks stay on.
-- Shared identity lives in core_users (migrations/core); this module's role data in mnt_members.
-- ============================================================

-- This module's data about a person. The row is optional: no row = APPLICANT.
CREATE TABLE IF NOT EXISTS mnt_members (
  user_id          INT PRIMARY KEY,
  role             ENUM('APPLICANT','JE','AE','SE','DEAN','DIRECTOR','SYSADMIN','CLERICAL','ACCOUNTANT') NOT NULL DEFAULT 'APPLICANT',
  department       ENUM('Civil','Electrical','Horticulture','Administration','General') NOT NULL DEFAULT 'General',
  campus           ENUM('NORTH','SOUTH','BOTH') NULL,
  last_assigned_at DATETIME NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_mnt_members_user FOREIGN KEY (user_id) REFERENCES core_users(id) ON DELETE CASCADE,
  INDEX idx_mnt_members_role_dept (role, department)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mnt_tickets (
  `id` int NOT NULL AUTO_INCREMENT,
  `applicant_id` int NOT NULL,
  `assigned_je_id` int DEFAULT NULL,
  `assigned_ae_id` int DEFAULT NULL,
  `assigned_se_id` int DEFAULT NULL,
  `current_desk_user_id` int DEFAULT NULL,
  `open_change_request_id` int DEFAULT NULL,
  `status_changed_at` datetime DEFAULT NULL,
  `assigned_at` datetime DEFAULT NULL,
  `department` enum('Civil','Electrical','Horticulture') NOT NULL,
  `campus` enum('NORTH','SOUTH') DEFAULT NULL,
  `building` varchar(150) DEFAULT NULL,
  `landmark` varchar(255) DEFAULT NULL,
  `lat` decimal(9,6) DEFAULT NULL,
  `lng` decimal(9,6) DEFAULT NULL,
  `category` varchar(50) DEFAULT NULL,
  `contact_phone` varchar(20) DEFAULT NULL,
  `priority` enum('LOW','NORMAL','URGENT') NOT NULL DEFAULT 'NORMAL',
  `title` varchar(255) DEFAULT NULL,
  `type` enum('recurring','non-recurring') DEFAULT 'recurring',
  `description` text NOT NULL,
  `location` varchar(255) DEFAULT NULL,
  `status` enum('UNASSIGNED','ASSIGNED_TO_JE','PENDING_AE_APPROVAL','PENDING_SE_APPROVAL','PENDING_DEAN_APPROVAL','PENDING_DIRECTOR_APPROVAL','APPROVED_FOR_TENDERING','TENDER_PUBLISHED','TECHNICAL_EVALUATION','FINANCIAL_EVALUATION','TENDER_CANCELLED','WORK_IN_PROGRESS','WORK_COMPLETED','RETURNED_TO_JE','DENIED','CLOSED') NOT NULL DEFAULT 'ASSIGNED_TO_JE',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `is_mock` tinyint(1) NOT NULL DEFAULT '0',
  `resolved_from_status` varchar(40) DEFAULT NULL,
  `resolved_at` datetime DEFAULT NULL,
  `is_demo` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `applicant_id` (`applicant_id`),
  KEY `idx_status_dept_date` (`status`,`department`,`created_at`),
  KEY `idx_assigned_je` (`assigned_je_id`),
  KEY `idx_current_desk_user` (`current_desk_user_id`),
  KEY `idx_assigned_ae` (`assigned_ae_id`),
  KEY `idx_assigned_se` (`assigned_se_id`),
  KEY `idx_is_mock` (`is_mock`),
  KEY `idx_is_demo` (`is_demo`),
  CONSTRAINT `fk_mnt_tickets_assigned_ae` FOREIGN KEY (`assigned_ae_id`) REFERENCES `core_users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_mnt_tickets_assigned_se` FOREIGN KEY (`assigned_se_id`) REFERENCES `core_users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_mnt_tickets_current_desk_user` FOREIGN KEY (`current_desk_user_id`) REFERENCES `core_users` (`id`),
  CONSTRAINT `fk_mnt_tickets_applicant` FOREIGN KEY (`applicant_id`) REFERENCES `core_users` (`id`),
  CONSTRAINT `fk_mnt_tickets_assigned_je` FOREIGN KEY (`assigned_je_id`) REFERENCES `core_users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mnt_audit_logs (
  `id` int NOT NULL AUTO_INCREMENT,
  `ticket_id` int NOT NULL,
  `user_id` int NOT NULL,
  `action` enum('CREATED','ASSIGNED','REASSIGNED','REMINDER_SENT','SUBMITTED','FORWARDED','APPROVED','CHANGES_REQUESTED','REJECTED','TENDER_PUBLISHED','WORK_AWARDED','WORK_COMPLETED','WORK_REOPENED','BILL_RECORDED','BILL_UPDATED','CLOSED','OVERRIDE','PASSED','RETURNED','DENIED','TECH_EVALUATION','FIN_EVALUATION','TENDER_CANCELLED','RESOLVED','SENT_BACK') NOT NULL,
  `remarks` text,
  `from_status` varchar(40) DEFAULT NULL,
  `to_status` varchar(40) DEFAULT NULL,
  `from_desk` varchar(20) DEFAULT NULL,
  `to_desk` varchar(20) DEFAULT NULL,
  `visibility` enum('ALL','INTERNAL','AUTHORITY') NOT NULL DEFAULT 'ALL',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `is_self_action` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `idx_ticket_timeline` (`ticket_id`,`created_at`),
  CONSTRAINT `fk_mnt_audit_logs_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `mnt_tickets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mnt_audit_logs_user` FOREIGN KEY (`user_id`) REFERENCES `core_users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mnt_ticket_messages (
  `id` int NOT NULL AUTO_INCREMENT,
  `ticket_id` int NOT NULL,
  `audit_log_id` int DEFAULT NULL,
  `author_user_id` int NOT NULL,
  `author_desk` varchar(20) NOT NULL,
  `to_user_id` int DEFAULT NULL,
  `to_desk` varchar(20) DEFAULT NULL,
  `kind` enum('CHANGE_REQUEST','REPLY','INTERNAL_REMARK','REJECTION_REASON','PUBLIC_NOTE') NOT NULL,
  `body` text NOT NULL,
  `visible_from_rank` tinyint unsigned NOT NULL,
  `in_reply_to` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `author_user_id` (`author_user_id`),
  KEY `in_reply_to` (`in_reply_to`),
  KEY `idx_ticket_messages_ticket` (`ticket_id`),
  KEY `idx_ticket_messages_to_user` (`to_user_id`),
  CONSTRAINT `fk_mnt_ticket_messages_audit` FOREIGN KEY (`audit_log_id`) REFERENCES `mnt_audit_logs` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_mnt_ticket_messages_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `mnt_tickets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mnt_ticket_messages_author` FOREIGN KEY (`author_user_id`) REFERENCES `core_users` (`id`),
  CONSTRAINT `fk_mnt_ticket_messages_to_user` FOREIGN KEY (`to_user_id`) REFERENCES `core_users` (`id`),
  CONSTRAINT `fk_mnt_ticket_messages_in_reply_to` FOREIGN KEY (`in_reply_to`) REFERENCES `mnt_ticket_messages` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mnt_reports (
  `id` int NOT NULL AUTO_INCREMENT,
  `ticket_id` int NOT NULL,
  `je_id` int NOT NULL,
  `version` int NOT NULL DEFAULT '1',
  `nature_of_work` text NOT NULL,
  `estimated_amount` decimal(15,2) NOT NULL,
  `remarks` text,
  `answers_message_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_report_ticket_version` (`ticket_id`,`version`),
  KEY `je_id` (`je_id`),
  KEY `idx_ticket` (`ticket_id`),
  CONSTRAINT `fk_mnt_reports_answers_message` FOREIGN KEY (`answers_message_id`) REFERENCES `mnt_ticket_messages` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_mnt_reports_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `mnt_tickets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mnt_reports_je` FOREIGN KEY (`je_id`) REFERENCES `core_users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mnt_attachments (
  `id` int NOT NULL AUTO_INCREMENT,
  `ticket_id` int NOT NULL,
  `report_id` int DEFAULT NULL,
  `file_url` varchar(255) NOT NULL,
  `uploaded_by` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `document_category` enum('APPLICANT_EVIDENCE','JE_SITE_PHOTO','JE_ESTIMATE_DOC','CLERK_TENDER_DOC','FINANCE_SANCTION','AUTHORITY_REMARKS','DESK_DOC','WORK_DOC') NOT NULL DEFAULT 'APPLICANT_EVIDENCE',
  `uploader_desk` varchar(20) DEFAULT NULL,
  `audit_log_id` int DEFAULT NULL,
  `original_name` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `uploaded_by` (`uploaded_by`),
  KEY `idx_ticket` (`ticket_id`),
  KEY `idx_attachments_audit` (`audit_log_id`),
  CONSTRAINT `fk_mnt_attachments_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `mnt_tickets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mnt_attachments_uploader` FOREIGN KEY (`uploaded_by`) REFERENCES `core_users` (`id`),
  CONSTRAINT `fk_mnt_attachments_audit` FOREIGN KEY (`audit_log_id`) REFERENCES `mnt_audit_logs` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_mnt_attachments_report` FOREIGN KEY (`report_id`) REFERENCES `mnt_reports` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mnt_tenders (
  `id` int NOT NULL AUTO_INCREMENT,
  `ticket_id` int NOT NULL,
  `nit_number` varchar(100) DEFAULT NULL,
  `portal_type` enum('GeM','CPP Portal','State Tender') NOT NULL DEFAULT 'GeM',
  `published_date` date DEFAULT NULL,
  `bid_opening_date` date DEFAULT NULL,
  `awarded_agency` varchar(255) DEFAULT NULL,
  `work_order_value` decimal(15,2) DEFAULT NULL,
  `status` enum('PUBLISHED','EVALUATION','TECHNICAL_EVALUATION','FINANCIAL_EVALUATION','AWARDED','CANCELLED') DEFAULT 'PUBLISHED',
  `remarks` text,
  `created_by` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `bid_end_date` date DEFAULT NULL,
  `cancel_reason` text,
  PRIMARY KEY (`id`),
  KEY `created_by` (`created_by`),
  KEY `idx_ticket` (`ticket_id`),
  CONSTRAINT `fk_mnt_tenders_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `mnt_tickets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mnt_tenders_created_by` FOREIGN KEY (`created_by`) REFERENCES `core_users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mnt_bills (
  `id` int NOT NULL AUTO_INCREMENT,
  `ticket_id` int NOT NULL,
  `bill_number` varchar(100) NOT NULL,
  `voucher_number` varchar(100) DEFAULT NULL,
  `agency_name` varchar(255) NOT NULL,
  `bill_type` enum('RA_BILL','FINAL_BILL','ADVANCE','SECURITY_REFUND') NOT NULL DEFAULT 'RA_BILL',
  `gross_amount` decimal(15,2) NOT NULL,
  `deductions` decimal(15,2) DEFAULT '0.00',
  `net_amount` decimal(15,2) NOT NULL,
  `payment_status` enum('PENDING','VERIFIED','DISBURSED','REJECTED') DEFAULT 'PENDING',
  `payment_date` date DEFAULT NULL,
  `payment_mode` varchar(50) DEFAULT 'PFMS',
  `remarks` text,
  `processed_by` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `processed_by` (`processed_by`),
  KEY `idx_ticket` (`ticket_id`),
  CONSTRAINT `fk_mnt_bills_processed_by` FOREIGN KEY (`processed_by`) REFERENCES `core_users` (`id`),
  CONSTRAINT `fk_mnt_bills_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `mnt_tickets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mnt_financial_limits (
  `key` varchar(50) NOT NULL,
  `max_amount` decimal(15,2) NOT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` int DEFAULT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mnt_user_scopes (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `department` enum('Civil','Electrical','Horticulture','Administration','General') NOT NULL,
  `campus` enum('NORTH','SOUTH','BOTH') NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_scope` (`user_id`,`department`,`campus`),
  KEY `idx_scope_dept_campus` (`department`,`campus`),
  CONSTRAINT `fk_mnt_user_scopes_user` FOREIGN KEY (`user_id`) REFERENCES `core_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mnt_user_availability (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `start_at` datetime NOT NULL,
  `end_at` datetime NOT NULL,
  `reason` varchar(255) DEFAULT NULL,
  `created_by` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `created_by` (`created_by`),
  KEY `idx_availability_user_window` (`user_id`,`start_at`,`end_at`),
  CONSTRAINT `fk_mnt_user_availability_user` FOREIGN KEY (`user_id`) REFERENCES `core_users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mnt_user_availability_created_by` FOREIGN KEY (`created_by`) REFERENCES `core_users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mnt_notifications (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `ticket_id` int DEFAULT NULL,
  `to_user_id` int NOT NULL,
  `kind` enum('EMAIL','REMINDER','DIGEST') NOT NULL DEFAULT 'EMAIL',
  `audience` enum('STAFF','APPLICANT') NOT NULL DEFAULT 'STAFF',
  `desk` varchar(20) DEFAULT NULL,
  `subject` varchar(255) NOT NULL,
  `body` text NOT NULL,
  `status` enum('PENDING','SENT','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `next_due_at` datetime NOT NULL,
  `anchor_at` datetime DEFAULT NULL,
  `reminder_no` int NOT NULL DEFAULT '0',
  `stop_when_status_not_in` varchar(255) DEFAULT NULL,
  `attempts` int NOT NULL DEFAULT '0',
  `last_error` varchar(500) DEFAULT NULL,
  `locked_until` datetime DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `dedupe_key` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_notifications_dedupe` (`dedupe_key`),
  KEY `to_user_id` (`to_user_id`),
  KEY `idx_notifications_due` (`status`,`next_due_at`),
  KEY `idx_notifications_ticket` (`ticket_id`,`kind`,`status`),
  CONSTRAINT `fk_mnt_notifications_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `mnt_tickets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mnt_notifications_to_user` FOREIGN KEY (`to_user_id`) REFERENCES `core_users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mnt_deleted_tickets (
  `id` int NOT NULL AUTO_INCREMENT,
  `ticket_id` int NOT NULL,
  `deleted_by` int DEFAULT NULL,
  `deleted_by_name` varchar(255) DEFAULT NULL,
  `deleted_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reason` text NOT NULL,
  `snapshot` json NOT NULL,
  `file_count` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_deleted_tickets_ticket` (`ticket_id`),
  KEY `idx_deleted_tickets_at` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- The view the module reads: the columns the code reads from `users` today.
-- Writes go to core_users and mnt_members, never to this view (it is a join).
CREATE OR REPLACE SQL SECURITY INVOKER VIEW mnt_users AS
SELECT u.id, u.firebase_uid, u.name, u.email,
       COALESCE(m.role, 'APPLICANT')     AS role,
       COALESCE(m.department, 'General') AS department,
       m.campus, m.last_assigned_at, u.phone,
       (u.is_active AND COALESCE(m.is_active, TRUE)) AS is_active,
       u.is_demo, u.created_at
  FROM core_users u
  LEFT JOIN mnt_members m ON m.user_id = u.id;

-- Seed data ------------------------------------------------------------------
INSERT IGNORE INTO mnt_financial_limits (`key`, max_amount) VALUES
  ('SE_APPROVE', 50000.00),
  ('DEAN_APPROVE', 500000.00),
  ('DIRECT_AWARD', 10000.00),
  ('DEAN_HIGH_VALUE', 200000.00);

-- Single Dean / Director placeholders. Created only when no active holder exists
-- and the placeholder is absent; reactivated when no holder is active.
-- .invalid is reserved (RFC 2606): mail can never reach a real person.
-- The derived table x is required: MySQL forbids a subquery on the table being updated.
INSERT INTO core_users (firebase_uid, name, email, is_active)
SELECT 'placeholder_dean', 'Dean (placeholder)', 'dean@placeholder.invalid', TRUE
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM mnt_users WHERE role = 'DEAN' AND is_active = TRUE)
   AND NOT EXISTS (SELECT 1 FROM core_users WHERE email = 'dean@placeholder.invalid');

INSERT IGNORE INTO mnt_members (user_id, role, department, is_active)
SELECT u.id, 'DEAN', 'Administration', TRUE
  FROM core_users u
 WHERE u.email = 'dean@placeholder.invalid'
   AND NOT EXISTS (SELECT 1 FROM mnt_users WHERE role = 'DEAN' AND is_active = TRUE);

UPDATE core_users u JOIN mnt_members m ON m.user_id = u.id
   SET u.is_active = TRUE, m.is_active = TRUE
 WHERE u.email = 'dean@placeholder.invalid'
   AND (SELECT c FROM (SELECT COUNT(*) AS c FROM mnt_users WHERE role = 'DEAN' AND is_active = TRUE) x) = 0;

INSERT INTO core_users (firebase_uid, name, email, is_active)
SELECT 'placeholder_director', 'Director (placeholder)', 'director@placeholder.invalid', TRUE
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM mnt_users WHERE role = 'DIRECTOR' AND is_active = TRUE)
   AND NOT EXISTS (SELECT 1 FROM core_users WHERE email = 'director@placeholder.invalid');

INSERT IGNORE INTO mnt_members (user_id, role, department, is_active)
SELECT u.id, 'DIRECTOR', 'Administration', TRUE
  FROM core_users u
 WHERE u.email = 'director@placeholder.invalid'
   AND NOT EXISTS (SELECT 1 FROM mnt_users WHERE role = 'DIRECTOR' AND is_active = TRUE);

UPDATE core_users u JOIN mnt_members m ON m.user_id = u.id
   SET u.is_active = TRUE, m.is_active = TRUE
 WHERE u.email = 'director@placeholder.invalid'
   AND (SELECT c FROM (SELECT COUNT(*) AS c FROM mnt_users WHERE role = 'DIRECTOR' AND is_active = TRUE) x) = 0;
