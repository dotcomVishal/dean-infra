-- ============================================================
-- Migration 014 — demo world flags (Agent/demo-plan.md, Phase 1).
--
--   users.is_demo     demo LDAP accounts (one per role)
--   tickets.is_demo   tickets raised by a demo account (also is_mock = TRUE)
--
-- SAFE BY CONSTRUCTION: additive only, NOT NULL DEFAULT FALSE, no data rows.
-- The previous container ignores both columns. Every statement is guarded,
-- so the file is re-runnable after a partial failure.
-- ============================================================

USE deanery_infra;

SET @dbname = DATABASE();

SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_demo'
  ) > 0,
  "SELECT 1",
  "ALTER TABLE users ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT FALSE"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'is_demo'
  ) > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT FALSE"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND INDEX_NAME = 'idx_is_demo'
  ) > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD INDEX idx_is_demo (is_demo)"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- PROVE IT WORKED ------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND COLUMN_NAME = 'is_demo' AND TABLE_NAME IN ('users', 'tickets');
