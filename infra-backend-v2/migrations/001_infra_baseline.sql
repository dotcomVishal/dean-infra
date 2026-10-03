-- ============================================================
-- Baseline 001 -- the whole Infra module schema, every table prefixed `infra_`.
--
-- Replaces schema.sql and the nine legacy migrations (they remain in git
-- history). Created with plain CREATE TABLE on purpose: a name collision stops
-- the boot instead of silently adopting somebody else's table.
--
-- Rules: no USE, no CREATE DATABASE, no DROP. The module owns `infra_*` only.
-- Every table declares its own engine, charset and collation, so the database
-- default is never relied on.
-- ============================================================

CREATE TABLE infra_users (
  id INT NOT NULL AUTO_INCREMENT,
  firebase_uid VARCHAR(128) NOT NULL,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL,
  role ENUM('APPLICANT','JE','AE','SE','DEAN','DIRECTOR','SYSADMIN') NOT NULL,
  department ENUM('Civil','Electrical','Horticulture','Administration','General') NOT NULL,
  campus ENUM('NORTH','SOUTH','BOTH') DEFAULT NULL,
  last_assigned_at DATETIME DEFAULT NULL,
  phone VARCHAR(20) DEFAULT NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY firebase_uid (firebase_uid),
  UNIQUE KEY email (email),
  KEY idx_role_dept (role, department)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE infra_user_scopes (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  department ENUM('Civil','Electrical','Horticulture','Administration','General') NOT NULL,
  campus ENUM('NORTH','SOUTH','BOTH') NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_scope (user_id, department, campus),
  KEY idx_scope_dept_campus (department, campus),
  CONSTRAINT fk_infra_user_scopes_user FOREIGN KEY (user_id) REFERENCES infra_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE infra_user_availability (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  start_at DATETIME NOT NULL,
  end_at DATETIME NOT NULL,
  reason VARCHAR(255) DEFAULT NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY created_by (created_by),
  KEY idx_availability_user_window (user_id, start_at, end_at),
  CONSTRAINT fk_infra_availability_user FOREIGN KEY (user_id) REFERENCES infra_users (id) ON DELETE CASCADE,
  CONSTRAINT fk_infra_availability_creator FOREIGN KEY (created_by) REFERENCES infra_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE infra_tickets (
  id INT NOT NULL AUTO_INCREMENT,
  applicant_id INT NOT NULL,
  assigned_je_id INT DEFAULT NULL,
  assigned_ae_id INT DEFAULT NULL,
  assigned_se_id INT DEFAULT NULL,
  current_desk_user_id INT DEFAULT NULL,
  open_change_request_id INT DEFAULT NULL,
  status_changed_at DATETIME DEFAULT NULL,
  assigned_at DATETIME DEFAULT NULL,
  department ENUM('Civil','Electrical','Horticulture') NOT NULL,
  campus ENUM('NORTH','SOUTH') DEFAULT NULL,
  landmark VARCHAR(255) DEFAULT NULL,
  lat DECIMAL(9,6) DEFAULT NULL,
  lng DECIMAL(9,6) DEFAULT NULL,
  contact_phone VARCHAR(20) DEFAULT NULL,
  priority ENUM('LOW','NORMAL','URGENT') NOT NULL DEFAULT 'NORMAL',
  title VARCHAR(255) DEFAULT NULL,
  type ENUM('recurring','non-recurring') DEFAULT 'recurring',
  description TEXT NOT NULL,
  status ENUM('UNASSIGNED','ASSIGNED_TO_JE','PENDING_AE_APPROVAL','PENDING_SE_APPROVAL','PENDING_DEAN_APPROVAL','PENDING_DIRECTOR_APPROVAL','APPROVED_FOR_TENDERING','TENDER_PUBLISHED','TECHNICAL_EVALUATION','FINANCIAL_EVALUATION','WORK_IN_PROGRESS','WORK_COMPLETED','RETURNED_TO_JE','DENIED','CLOSED') NOT NULL DEFAULT 'ASSIGNED_TO_JE',
  resolved_from_status VARCHAR(40) DEFAULT NULL,
  resolved_at DATETIME DEFAULT NULL,
  resolved_by INT DEFAULT NULL,
  resolution_kind ENUM('COMPLETED','TENDER_CANCELLED','OVERRIDE') DEFAULT NULL,
  applicant_sent_back_at DATETIME DEFAULT NULL,
  reopen_count INT NOT NULL DEFAULT 0,
  closed_at DATETIME DEFAULT NULL,
  deleted_at DATETIME DEFAULT NULL,
  deleted_by INT DEFAULT NULL,
  delete_reason VARCHAR(1000) DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  is_mock TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY applicant_id (applicant_id),
  KEY idx_status_dept_date (status, department, created_at),
  KEY idx_assigned_je (assigned_je_id),
  KEY idx_current_desk_user (current_desk_user_id),
  KEY idx_assigned_ae (assigned_ae_id),
  KEY idx_assigned_se (assigned_se_id),
  KEY idx_is_mock (is_mock),
  KEY idx_resolved (status, resolved_at),
  KEY idx_deleted_at (deleted_at),
  CONSTRAINT fk_infra_tickets_applicant FOREIGN KEY (applicant_id) REFERENCES infra_users (id),
  CONSTRAINT fk_infra_tickets_assigned_je FOREIGN KEY (assigned_je_id) REFERENCES infra_users (id),
  CONSTRAINT fk_infra_tickets_assigned_ae FOREIGN KEY (assigned_ae_id) REFERENCES infra_users (id) ON DELETE SET NULL,
  CONSTRAINT fk_infra_tickets_assigned_se FOREIGN KEY (assigned_se_id) REFERENCES infra_users (id) ON DELETE SET NULL,
  CONSTRAINT fk_infra_tickets_current_desk_user FOREIGN KEY (current_desk_user_id) REFERENCES infra_users (id),
  CONSTRAINT fk_infra_tickets_resolved_by FOREIGN KEY (resolved_by) REFERENCES infra_users (id) ON DELETE SET NULL,
  CONSTRAINT fk_infra_tickets_deleted_by FOREIGN KEY (deleted_by) REFERENCES infra_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE infra_audit_logs (
  id INT NOT NULL AUTO_INCREMENT,
  ticket_id INT NOT NULL,
  user_id INT NOT NULL,
  action ENUM('CREATED','ASSIGNED','REASSIGNED','REMINDER_SENT','SUBMITTED','FORWARDED','APPROVED','CHANGES_REQUESTED','REJECTED','TENDER_PUBLISHED','WORK_AWARDED','WORK_COMPLETED','WORK_REOPENED','CLOSED','OVERRIDE','FILES_ADDED','TECH_EVAL_STARTED','FIN_EVAL_STARTED','TENDER_CANCELLED','RESOLVED','AUTO_CLOSED','DELETED','RESTORED') NOT NULL,
  remarks TEXT,
  from_status VARCHAR(40) DEFAULT NULL,
  to_status VARCHAR(40) DEFAULT NULL,
  from_desk VARCHAR(20) DEFAULT NULL,
  to_desk VARCHAR(20) DEFAULT NULL,
  visibility ENUM('ALL','INTERNAL','AUTHORITY') NOT NULL DEFAULT 'ALL',
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  is_self_action TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY user_id (user_id),
  KEY idx_ticket_timeline (ticket_id, created_at),
  CONSTRAINT fk_infra_audit_ticket FOREIGN KEY (ticket_id) REFERENCES infra_tickets (id) ON DELETE CASCADE,
  CONSTRAINT fk_infra_audit_user FOREIGN KEY (user_id) REFERENCES infra_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE infra_ticket_messages (
  id INT NOT NULL AUTO_INCREMENT,
  ticket_id INT NOT NULL,
  audit_log_id INT DEFAULT NULL,
  author_user_id INT NOT NULL,
  author_desk VARCHAR(20) NOT NULL,
  to_user_id INT DEFAULT NULL,
  to_desk VARCHAR(20) DEFAULT NULL,
  kind ENUM('CHANGE_REQUEST','REPLY','INTERNAL_REMARK','REJECTION_REASON','PUBLIC_NOTE') NOT NULL,
  body TEXT NOT NULL,
  visible_from_rank TINYINT UNSIGNED NOT NULL,
  in_reply_to INT DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY author_user_id (author_user_id),
  KEY in_reply_to (in_reply_to),
  KEY idx_ticket_messages_ticket (ticket_id),
  KEY idx_ticket_messages_to_user (to_user_id),
  KEY fk_infra_messages_audit (audit_log_id),
  CONSTRAINT fk_infra_messages_ticket FOREIGN KEY (ticket_id) REFERENCES infra_tickets (id) ON DELETE CASCADE,
  CONSTRAINT fk_infra_messages_author FOREIGN KEY (author_user_id) REFERENCES infra_users (id),
  CONSTRAINT fk_infra_messages_to FOREIGN KEY (to_user_id) REFERENCES infra_users (id),
  CONSTRAINT fk_infra_messages_reply FOREIGN KEY (in_reply_to) REFERENCES infra_ticket_messages (id) ON DELETE SET NULL,
  CONSTRAINT fk_infra_messages_audit FOREIGN KEY (audit_log_id) REFERENCES infra_audit_logs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE infra_reports (
  id INT NOT NULL AUTO_INCREMENT,
  ticket_id INT NOT NULL,
  je_id INT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  nature_of_work TEXT NOT NULL,
  estimated_amount DECIMAL(14,2) NOT NULL,
  remarks TEXT,
  answers_message_id INT DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_report_ticket_version (ticket_id, version),
  KEY je_id (je_id),
  KEY idx_ticket (ticket_id),
  KEY fk_infra_reports_answers_message (answers_message_id),
  CONSTRAINT fk_infra_reports_ticket FOREIGN KEY (ticket_id) REFERENCES infra_tickets (id) ON DELETE CASCADE,
  CONSTRAINT fk_infra_reports_je FOREIGN KEY (je_id) REFERENCES infra_users (id),
  CONSTRAINT fk_infra_reports_answers_message FOREIGN KEY (answers_message_id) REFERENCES infra_ticket_messages (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE infra_attachments (
  id INT NOT NULL AUTO_INCREMENT,
  ticket_id INT NOT NULL,
  report_id INT DEFAULT NULL,
  file_url VARCHAR(512) NOT NULL,
  original_name VARCHAR(255) DEFAULT NULL,
  size_bytes INT DEFAULT NULL,
  uploaded_by INT NOT NULL,
  uploader_desk VARCHAR(20) DEFAULT NULL,
  audit_log_id INT DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  document_category ENUM('APPLICANT_EVIDENCE','JE_SITE_PHOTO','JE_ESTIMATE_DOC','DESK_DOC','WORK_DOC') NOT NULL DEFAULT 'APPLICANT_EVIDENCE',
  PRIMARY KEY (id),
  KEY uploaded_by (uploaded_by),
  KEY idx_ticket (ticket_id),
  KEY fk_infra_attachments_report (report_id),
  KEY idx_attachments_audit (audit_log_id),
  CONSTRAINT fk_infra_attachments_ticket FOREIGN KEY (ticket_id) REFERENCES infra_tickets (id) ON DELETE CASCADE,
  CONSTRAINT fk_infra_attachments_user FOREIGN KEY (uploaded_by) REFERENCES infra_users (id),
  CONSTRAINT fk_infra_attachments_report FOREIGN KEY (report_id) REFERENCES infra_reports (id) ON DELETE SET NULL,
  CONSTRAINT fk_infra_attachments_audit FOREIGN KEY (audit_log_id) REFERENCES infra_audit_logs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE infra_tenders (
  id INT NOT NULL AUTO_INCREMENT,
  ticket_id INT NOT NULL,
  nit_number VARCHAR(100) DEFAULT NULL,
  portal_type ENUM('GeM','CPP Portal','State Tender') NOT NULL DEFAULT 'GeM',
  tender_created_date DATE DEFAULT NULL,
  tender_end_date DATE DEFAULT NULL,
  technical_eval_at DATETIME DEFAULT NULL,
  financial_eval_at DATETIME DEFAULT NULL,
  awarded_agency VARCHAR(255) DEFAULT NULL,
  award_amount DECIMAL(14,2) DEFAULT NULL,
  awarded_at DATETIME DEFAULT NULL,
  cancelled_at DATETIME DEFAULT NULL,
  cancel_reason TEXT,
  status ENUM('PUBLISHED','TECHNICAL_EVALUATION','FINANCIAL_EVALUATION','AWARDED','CANCELLED') NOT NULL DEFAULT 'PUBLISHED',
  remarks TEXT,
  created_by INT NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tender_ticket (ticket_id),
  KEY created_by (created_by),
  CONSTRAINT fk_infra_tenders_ticket FOREIGN KEY (ticket_id) REFERENCES infra_tickets (id) ON DELETE CASCADE,
  CONSTRAINT fk_infra_tenders_user FOREIGN KEY (created_by) REFERENCES infra_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE infra_financial_limits (
  `key` VARCHAR(50) NOT NULL,
  max_amount DECIMAL(12,2) NOT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE infra_notifications (
  id BIGINT NOT NULL AUTO_INCREMENT,
  ticket_id INT DEFAULT NULL,
  to_user_id INT NOT NULL,
  kind ENUM('EMAIL','REMINDER','DIGEST') NOT NULL DEFAULT 'EMAIL',
  audience ENUM('STAFF','APPLICANT') NOT NULL DEFAULT 'STAFF',
  desk VARCHAR(20) DEFAULT NULL,
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  status ENUM('PENDING','SENT','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  next_due_at DATETIME NOT NULL,
  anchor_at DATETIME DEFAULT NULL,
  reminder_no INT NOT NULL DEFAULT 0,
  stop_when_status_not_in VARCHAR(255) DEFAULT NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error VARCHAR(500) DEFAULT NULL,
  locked_until DATETIME DEFAULT NULL,
  sent_at DATETIME DEFAULT NULL,
  dedupe_key VARCHAR(100) DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notifications_dedupe (dedupe_key),
  KEY to_user_id (to_user_id),
  KEY idx_notifications_due (status, next_due_at),
  KEY idx_notifications_ticket (ticket_id, kind, status),
  CONSTRAINT fk_infra_notifications_ticket FOREIGN KEY (ticket_id) REFERENCES infra_tickets (id) ON DELETE CASCADE,
  CONSTRAINT fk_infra_notifications_user FOREIGN KEY (to_user_id) REFERENCES infra_users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed: approval ceilings.
INSERT INTO infra_financial_limits (`key`, max_amount) VALUES
  ('SE_APPROVE', 50000.00),
  ('DEAN_APPROVE', 500000.00),
  ('DIRECT_AWARD', 10000.00);

-- Seed: one placeholder Dean and Director so desk resolution always has a holder.
-- .invalid is reserved (RFC 2606): mail can never reach a real person.
INSERT INTO infra_users (firebase_uid, name, email, role, department, is_active) VALUES
  ('placeholder_dean', 'Dean (placeholder)', 'dean@placeholder.invalid', 'DEAN', 'Administration', TRUE),
  ('placeholder_director', 'Director (placeholder)', 'director@placeholder.invalid', 'DIRECTOR', 'Administration', TRUE);
