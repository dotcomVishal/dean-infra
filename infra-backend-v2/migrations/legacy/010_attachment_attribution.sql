-- ============================================================
-- Migration 010 — who attached a file, and with which movement (Master-plan Phase 2)
--
--   attachments.uploader_desk   the desk / role the person acted as, recorded at
--                               upload time (so a later role change cannot
--                               rewrite history or visibility)
--   attachments.audit_log_id    the movement the file was attached with
--   attachments.original_name   the name as uploaded
--
-- SAFE BY CONSTRUCTION: additive and nullable; every statement is guarded or
-- idempotent, so the file is re-runnable after a partial failure.
-- ============================================================

USE deanery_infra;

SET @dbname = DATABASE();

SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'attachments' AND COLUMN_NAME = 'uploader_desk') > 0, "SELECT 1", "ALTER TABLE attachments ADD COLUMN uploader_desk VARCHAR(20) NULL"));
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'attachments' AND COLUMN_NAME = 'audit_log_id') > 0, "SELECT 1", "ALTER TABLE attachments ADD COLUMN audit_log_id INT NULL"));
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'attachments' AND COLUMN_NAME = 'original_name') > 0, "SELECT 1", "ALTER TABLE attachments ADD COLUMN original_name VARCHAR(255) NULL"));
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'attachments' AND INDEX_NAME = 'idx_attachments_audit') > 0, "SELECT 1", "ALTER TABLE attachments ADD INDEX idx_attachments_audit (audit_log_id)"));
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'attachments' AND CONSTRAINT_NAME = 'fk_attachments_audit') > 0, "SELECT 1", "ALTER TABLE attachments ADD CONSTRAINT fk_attachments_audit FOREIGN KEY (audit_log_id) REFERENCES audit_logs(id) ON DELETE SET NULL"));
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Backfill: applicant evidence was uploaded as the applicant; every other file as the uploader's role.
UPDATE attachments a
  JOIN users u ON u.id = a.uploaded_by
   SET a.uploader_desk = CASE WHEN a.document_category = 'APPLICANT_EVIDENCE' THEN 'APPLICANT' ELSE u.role END
 WHERE a.uploader_desk IS NULL;
