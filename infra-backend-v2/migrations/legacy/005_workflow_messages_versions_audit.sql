-- ============================================================
-- Migration 005 — Workflow rewrite support (plan.md §4 Phase 4)
--
-- Adds:
--   - audit_logs.action gains the full movement vocabulary (§3.1); old values
--     stay so legacy rows remain valid.
--   - audit_logs.from_status/to_status/from_desk/to_desk/visibility
--   - ticket_messages.audit_log_id
--   - tickets.open_change_request_id / status_changed_at / assigned_at
--   - reports.version / remarks / answers_message_id (+ unique per ticket)
--   - attachments.report_id
--
-- SAFE BY CONSTRUCTION: every new column is nullable or defaulted, the ENUM
-- change only ADDS values, existing reports are backfilled with version
-- numbers 1..n per ticket in id order. Guarded like migrations 002-004.
-- ============================================================

USE deanery_infra;
SET @dbname = DATABASE();

-- 1. audit_logs.action — full movement vocabulary (plan.md §3.1). PASSED,
--    RETURNED and DENIED are kept only so rows written before this
--    migration stay valid; new code never writes them.
ALTER TABLE audit_logs
  MODIFY COLUMN action ENUM(
    'CREATED','ASSIGNED','REASSIGNED','REMINDER_SENT','SUBMITTED','FORWARDED',
    'APPROVED','CHANGES_REQUESTED','REJECTED','TENDER_PUBLISHED','WORK_AWARDED',
    'WORK_COMPLETED','BILL_RECORDED','BILL_UPDATED','CLOSED','OVERRIDE',
    'PASSED','RETURNED','DENIED'
  ) NOT NULL;

-- 2. audit_logs movement columns.
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'from_status') > 0,
  "SELECT 1",
  "ALTER TABLE audit_logs ADD COLUMN from_status VARCHAR(40) NULL AFTER remarks"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'to_status') > 0,
  "SELECT 1",
  "ALTER TABLE audit_logs ADD COLUMN to_status VARCHAR(40) NULL AFTER from_status"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'from_desk') > 0,
  "SELECT 1",
  "ALTER TABLE audit_logs ADD COLUMN from_desk VARCHAR(20) NULL AFTER to_status"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'to_desk') > 0,
  "SELECT 1",
  "ALTER TABLE audit_logs ADD COLUMN to_desk VARCHAR(20) NULL AFTER from_desk"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'visibility') > 0,
  "SELECT 1",
  "ALTER TABLE audit_logs ADD COLUMN visibility ENUM('ALL','INTERNAL','AUTHORITY') NOT NULL DEFAULT 'ALL' AFTER to_desk"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 3. ticket_messages.audit_log_id — the audit row a message belongs to.
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'ticket_messages' AND COLUMN_NAME = 'audit_log_id') > 0,
  "SELECT 1",
  "ALTER TABLE ticket_messages ADD COLUMN audit_log_id INT NULL AFTER ticket_id"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'ticket_messages'
      AND CONSTRAINT_NAME = 'fk_ticket_messages_audit') > 0,
  "SELECT 1",
  "ALTER TABLE ticket_messages ADD CONSTRAINT fk_ticket_messages_audit FOREIGN KEY (audit_log_id) REFERENCES audit_logs(id) ON DELETE SET NULL"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 4. tickets — active change-request pointer + timing.
--    open_change_request_id is deliberately NOT a foreign key: tickets <->
--    ticket_messages would be a circular FK, and ON DELETE CASCADE from a
--    ticket to its own messages would then fight the SET NULL back onto the
--    row being deleted. The application owns this pointer (see
--    controllers/actionController.js).
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'open_change_request_id') > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD COLUMN open_change_request_id INT NULL AFTER current_desk_user_id"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'status_changed_at') > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD COLUMN status_changed_at DATETIME NULL AFTER open_change_request_id"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'assigned_at') > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD COLUMN assigned_at DATETIME NULL AFTER status_changed_at"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 5. reports — versioning. Existing rows are numbered 1..n per ticket in id
--    order BEFORE the unique key goes on.
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'reports' AND COLUMN_NAME = 'version') > 0,
  "SELECT 1",
  "ALTER TABLE reports ADD COLUMN version INT NOT NULL DEFAULT 1 AFTER je_id"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'reports' AND COLUMN_NAME = 'remarks') > 0,
  "SELECT 1",
  "ALTER TABLE reports ADD COLUMN remarks TEXT NULL AFTER estimated_amount"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'reports' AND COLUMN_NAME = 'answers_message_id') > 0,
  "SELECT 1",
  "ALTER TABLE reports ADD COLUMN answers_message_id INT NULL AFTER remarks"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

UPDATE reports r
  JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY ticket_id ORDER BY id) AS rn FROM reports) x
    ON x.id = r.id
   SET r.version = x.rn;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'reports' AND INDEX_NAME = 'uq_report_ticket_version') > 0,
  "SELECT 1",
  "ALTER TABLE reports ADD UNIQUE KEY uq_report_ticket_version (ticket_id, version)"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'reports'
      AND CONSTRAINT_NAME = 'fk_reports_answers_message') > 0,
  "SELECT 1",
  "ALTER TABLE reports ADD CONSTRAINT fk_reports_answers_message FOREIGN KEY (answers_message_id) REFERENCES ticket_messages(id) ON DELETE SET NULL"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 6. attachments.report_id — each report version owns its photos and docs.
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'attachments' AND COLUMN_NAME = 'report_id') > 0,
  "SELECT 1",
  "ALTER TABLE attachments ADD COLUMN report_id INT NULL AFTER ticket_id"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'attachments'
      AND CONSTRAINT_NAME = 'fk_attachments_report') > 0,
  "SELECT 1",
  "ALTER TABLE attachments ADD CONSTRAINT fk_attachments_report FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE SET NULL"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 7. PROVE IT WORKED ---------------------------------------------------------
SELECT COLUMN_TYPE FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'action';

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND ((TABLE_NAME = 'audit_logs' AND COLUMN_NAME IN ('from_status','to_status','from_desk','to_desk','visibility'))
     OR (TABLE_NAME = 'ticket_messages' AND COLUMN_NAME = 'audit_log_id')
     OR (TABLE_NAME = 'tickets' AND COLUMN_NAME IN ('open_change_request_id','status_changed_at','assigned_at'))
     OR (TABLE_NAME = 'reports' AND COLUMN_NAME IN ('version','remarks','answers_message_id'))
     OR (TABLE_NAME = 'attachments' AND COLUMN_NAME = 'report_id'));

SELECT ticket_id, COUNT(*) AS versions, MAX(version) AS max_version
  FROM reports GROUP BY ticket_id HAVING versions <> max_version;
