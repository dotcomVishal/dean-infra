-- ============================================================
-- Migration 003 — campus scope, ticket priority, desk routing,
-- addressed messages, financial limits.
--
-- Scope (plan.md §3.1, Phase 2 item 2): only the columns/tables needed to
-- unblock the campus + desk-routing work — users.campus, tickets.campus,
-- tickets.priority, tickets.current_desk_user_id, ticket_messages,
-- financial_limits. Full §3.1 (user_scopes, user_availability, reports
-- versioning, audit_logs action set, notifications, app_settings, the
-- status enum rename) is later phases, not this migration.
--
-- SAFE BY CONSTRUCTION: every new column is nullable or has a default, so
-- existing INSERTs from the current controllers (which know nothing about
-- these columns) keep working unmodified. Every ADD COLUMN / ADD
-- CONSTRAINT is guarded by an information_schema check, so this file is
-- re-runnable by hand; the migration runner also tracks it in
-- schema_migrations and will not apply it twice.
--
-- Run with:
--   mysql -u root -p deanery_infra < migrations/003_campus_desks_workflow.sql
-- or:
--   node scripts/migrate.mjs
-- ============================================================

USE deanery_infra;

-- 1. users.campus — scope for JE/AE/SE staff. NULL for roles that have no
--    campus (Clerical, Accountant, Dean, Director, applicants).
SET @dbname = DATABASE();
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND COLUMN_NAME = 'campus'
  ) > 0,
  "SELECT 1",
  "ALTER TABLE users ADD COLUMN campus ENUM('NORTH','SOUTH','BOTH') NULL AFTER department"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 2. tickets.campus — nullable for now (not NOT NULL): the raise-ticket
--    form does not collect it yet (that is Phase 3), so a NOT NULL column
--    would break every existing createTicket() call today.
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'campus'
  ) > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD COLUMN campus ENUM('NORTH','SOUTH') NULL AFTER department"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 3. tickets.priority — every ticket gets one; existing rows default to
--    NORMAL so nothing needs a backfill.
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'priority'
  ) > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD COLUMN priority ENUM('LOW','NORMAL','URGENT') NOT NULL DEFAULT 'NORMAL' AFTER campus"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 4. tickets.current_desk_user_id — the exact person who must act now.
--    Nullable: existing tickets simply have no value until the desk-routing
--    rewrite (Phase 4) starts setting it on every transition.
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'current_desk_user_id'
  ) > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD COLUMN current_desk_user_id INT NULL AFTER assigned_je_id"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets'
      AND CONSTRAINT_NAME = 'fk_tickets_current_desk_user'
  ) > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD CONSTRAINT fk_tickets_current_desk_user FOREIGN KEY (current_desk_user_id) REFERENCES users(id)"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND INDEX_NAME = 'idx_current_desk_user'
  ) > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD INDEX idx_current_desk_user (current_desk_user_id)"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 5. ticket_messages — addressed remarks/change-requests/replies (§3.1).
--    Replaces the plan for a "note_to_je" field: every remark is a row
--    here with an explicit sender, recipient and visibility rank, so W3
--    (the JE seeing "[Internal Authority Decision Recorded]" instead of
--    the actual remarks) has a real fix target once the workflow rewrite
--    (Phase 4) starts writing to it. Desk ranks: JE=1, AE=2, SE=3, Dean=4,
--    Director=5 (see plan.md §3.1/§3.6).
CREATE TABLE IF NOT EXISTS ticket_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT NOT NULL,
  author_user_id INT NOT NULL,
  author_desk VARCHAR(20) NOT NULL,
  to_user_id INT NULL,
  to_desk VARCHAR(20) NULL,
  kind ENUM('CHANGE_REQUEST','REPLY','INTERNAL_REMARK','REJECTION_REASON','PUBLIC_NOTE') NOT NULL,
  body TEXT NOT NULL,
  visible_from_rank TINYINT UNSIGNED NOT NULL,
  in_reply_to INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (author_user_id) REFERENCES users(id),
  FOREIGN KEY (to_user_id) REFERENCES users(id),
  FOREIGN KEY (in_reply_to) REFERENCES ticket_messages(id) ON DELETE SET NULL,
  INDEX idx_ticket_messages_ticket (ticket_id),
  INDEX idx_ticket_messages_to_user (to_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. financial_limits — replaces the hardcoded BUDGET_CEILING (Q2, Q9).
--    Seeded with the current code values for SE/Dean and a placeholder for
--    direct award; real amounts to be confirmed from the institute's
--    delegation of financial powers (plan.md Q14).
CREATE TABLE IF NOT EXISTS financial_limits (
  `key` VARCHAR(50) PRIMARY KEY,
  max_amount DECIMAL(12, 2) NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO financial_limits (`key`, max_amount) VALUES
  ('SE_APPROVE', 50000.00),
  ('DEAN_APPROVE', 500000.00),
  ('DIRECT_AWARD', 10000.00);

-- 7. PROVE IT WORKED ---------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND ((TABLE_NAME = 'users' AND COLUMN_NAME = 'campus')
     OR (TABLE_NAME = 'tickets' AND COLUMN_NAME IN ('campus','priority','current_desk_user_id')));

SELECT COUNT(*) AS ticket_messages_table_exists
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket_messages';

SELECT `key`, max_amount FROM financial_limits ORDER BY `key`;
