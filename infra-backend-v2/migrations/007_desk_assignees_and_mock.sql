-- ============================================================
-- Migration 007 — pinned AE/SE desk holders, mock-ticket flag, self-action
-- audit flag, single Dean/Director placeholders (plan2.md, Phase 1).
--
--   tickets.assigned_ae_id / assigned_se_id  pinned desk holders (nullable;
--                                            NULL keeps today's scope resolution)
--   tickets.is_mock                          Sysadmin test tickets
--   audit_logs.is_self_action                actor is the ticket's applicant
--   users                                    one placeholder Dean and Director
--                                            (.invalid e-mail) when none is active
--
-- SAFE BY CONSTRUCTION: additive only (no DROP / RENAME / ENUM rewrite). Every
-- column is nullable or has a default, so the previous container keeps working
-- against the new schema. Every statement is guarded or idempotent, so the file
-- is re-runnable after a partial failure (MySQL DDL auto-commits).
--
-- Run with:
--   node scripts/migrate.mjs
-- ============================================================

USE deanery_infra;

SET @dbname = DATABASE();

-- 1. Columns ------------------------------------------------------------------
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'assigned_ae_id'
  ) > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD COLUMN assigned_ae_id INT NULL AFTER assigned_je_id"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'assigned_se_id'
  ) > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD COLUMN assigned_se_id INT NULL AFTER assigned_ae_id"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'is_mock'
  ) > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD COLUMN is_mock BOOLEAN NOT NULL DEFAULT FALSE"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'is_self_action'
  ) > 0,
  "SELECT 1",
  "ALTER TABLE audit_logs ADD COLUMN is_self_action BOOLEAN NOT NULL DEFAULT FALSE"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 2. Foreign keys and indexes -------------------------------------------------
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND CONSTRAINT_NAME = 'fk_tickets_assigned_ae'
  ) > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD CONSTRAINT fk_tickets_assigned_ae FOREIGN KEY (assigned_ae_id) REFERENCES users(id) ON DELETE SET NULL"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND CONSTRAINT_NAME = 'fk_tickets_assigned_se'
  ) > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD CONSTRAINT fk_tickets_assigned_se FOREIGN KEY (assigned_se_id) REFERENCES users(id) ON DELETE SET NULL"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND INDEX_NAME = 'idx_assigned_ae'
  ) > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD INDEX idx_assigned_ae (assigned_ae_id)"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND INDEX_NAME = 'idx_assigned_se'
  ) > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD INDEX idx_assigned_se (assigned_se_id)"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND INDEX_NAME = 'idx_is_mock'
  ) > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD INDEX idx_is_mock (is_mock)"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 3. Backfill pinned holders (idempotent via IS NULL) ---------------------------
--    Only tickets currently sitting at that desk. Later stages keep dynamic
--    resolution. Existing audit rows stay is_self_action = FALSE (no backfill).
UPDATE tickets t JOIN users u ON u.id = t.current_desk_user_id AND u.role = 'AE'
   SET t.assigned_ae_id = t.current_desk_user_id
 WHERE t.assigned_ae_id IS NULL AND t.status IN ('UNASSIGNED','PENDING_AE_APPROVAL');

UPDATE tickets t JOIN users u ON u.id = t.current_desk_user_id AND u.role = 'SE'
   SET t.assigned_se_id = t.current_desk_user_id
 WHERE t.assigned_se_id IS NULL AND t.status = 'PENDING_SE_APPROVAL';

-- 4. Single Dean / Director placeholders ----------------------------------------
--    Insert only when no active holder exists and the placeholder is absent.
--    Reactivate an inactive placeholder when no holder is active. The derived
--    table x is required: MySQL forbids a subquery on the table being updated.
--    .invalid is reserved (RFC 2606): mail can never reach a real person.
INSERT INTO users (firebase_uid, name, email, role, department, is_active)
SELECT 'placeholder_dean', 'Dean (placeholder)', 'dean@placeholder.invalid', 'DEAN', 'Administration', TRUE
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'DEAN' AND is_active = TRUE)
   AND NOT EXISTS (SELECT 1 FROM users WHERE email = 'dean@placeholder.invalid');

UPDATE users SET is_active = TRUE
 WHERE email = 'dean@placeholder.invalid'
   AND (SELECT c FROM (SELECT COUNT(*) AS c FROM users WHERE role = 'DEAN' AND is_active = TRUE) x) = 0;

INSERT INTO users (firebase_uid, name, email, role, department, is_active)
SELECT 'placeholder_director', 'Director (placeholder)', 'director@placeholder.invalid', 'DIRECTOR', 'Administration', TRUE
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'DIRECTOR' AND is_active = TRUE)
   AND NOT EXISTS (SELECT 1 FROM users WHERE email = 'director@placeholder.invalid');

UPDATE users SET is_active = TRUE
 WHERE email = 'director@placeholder.invalid'
   AND (SELECT c FROM (SELECT COUNT(*) AS c FROM users WHERE role = 'DIRECTOR' AND is_active = TRUE) x) = 0;

-- PROVE IT WORKED ------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND ((TABLE_NAME = 'tickets' AND COLUMN_NAME IN ('assigned_ae_id','assigned_se_id','is_mock'))
     OR (TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'is_self_action'));

SELECT role, COUNT(*) AS active_holders
  FROM users
 WHERE role IN ('DEAN','DIRECTOR') AND is_active = TRUE
 GROUP BY role;
