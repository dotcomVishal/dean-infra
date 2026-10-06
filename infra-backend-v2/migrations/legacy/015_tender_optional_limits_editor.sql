-- ============================================================
-- Migration 015 -- optional NIT number, who changed an approval limit
--
--   tenders.nit_number           NOT NULL -> NULL. The JE no longer types a NIT number; an
--                                absent one is stored as NULL (a UNIQUE index allows many
--                                NULLs, but not two empty strings).
--   financial_limits.updated_by  user id of the Sysadmin who last changed the row.
--
-- SAFE BY CONSTRUCTION: both changes only loosen or add. No row is rewritten and no enum
-- is touched. The MODIFY keeps the column type; the file is re-runnable. Code from before
-- this migration always sends a NIT number, so a rollback needs no restore.
-- tenders.portal_type is deliberately left alone.
-- ============================================================

USE deanery_infra;

SET @dbname = DATABASE();

ALTER TABLE tenders MODIFY COLUMN nit_number VARCHAR(100) NULL;

SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'financial_limits' AND COLUMN_NAME = 'updated_by') > 0, "SELECT 1", "ALTER TABLE financial_limits ADD COLUMN updated_by INT NULL"));
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
