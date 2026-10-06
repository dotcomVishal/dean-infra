-- ============================================================
-- Migration 011 — e-mail policy and weekly digest (Master-plan Phase 4)
--
--   notifications.kind          + DIGEST   (the weekly summary mail)
--   notifications.dedupe_key    unique; a digest is written with INSERT IGNORE and the key
--                               "digest:<ISO week>:<user id>", so two instances or a restart
--                               never queue the same digest twice
--   live REMINDER rows for the AE and the applicant are cancelled: only the JE is reminded
--
-- SAFE BY CONSTRUCTION: the ENUM change only ADDS a value, the new column is nullable,
-- every statement is guarded or idempotent, so the file is re-runnable.
-- ============================================================

USE deanery_infra;

SET @dbname = DATABASE();

ALTER TABLE notifications
  MODIFY COLUMN kind ENUM('EMAIL','REMINDER','DIGEST') NOT NULL DEFAULT 'EMAIL';

SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'dedupe_key') > 0, "SELECT 1", "ALTER TABLE notifications ADD COLUMN dedupe_key VARCHAR(100) NULL"));
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'notifications' AND INDEX_NAME = 'uq_notifications_dedupe') > 0, "SELECT 1", "ALTER TABLE notifications ADD UNIQUE INDEX uq_notifications_dedupe (dedupe_key)"));
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

UPDATE notifications
   SET status = 'CANCELLED', locked_until = NULL, last_error = 'retired by e-mail policy'
 WHERE kind = 'REMINDER' AND status = 'PENDING' AND desk IN ('AE', 'APPLICANT');
