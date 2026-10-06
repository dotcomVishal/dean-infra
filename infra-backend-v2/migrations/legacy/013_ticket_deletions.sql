-- ============================================================
-- Migration 013 — Sysadmin ticket deletion (Master-plan Phase 7)
--
--   deleted_tickets   a tombstone per deleted ticket, with no foreign key to tickets
--                     (the audit log is deleted with the ticket, so this is the only record
--                     that the ticket existed, who removed it and why)
--   ticket foreign keys: a production database created from an older schema may declare a
--                     delete rule other than CASCADE on a child table. Any such key is dropped
--                     and recreated as ON DELETE CASCADE. The rules are printed before and after.
--
-- SAFE BY CONSTRUCTION: CREATE TABLE IF NOT EXISTS, and a key is only touched when its rule is not
-- CASCADE, so the file is re-runnable.
-- ============================================================

USE deanery_infra;

SET @dbname = DATABASE();

CREATE TABLE IF NOT EXISTS deleted_tickets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT NOT NULL,
  deleted_by INT NULL,
  deleted_by_name VARCHAR(255) NULL,
  deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT NOT NULL,
  snapshot JSON NOT NULL,
  file_count INT NOT NULL DEFAULT 0,
  INDEX idx_deleted_tickets_ticket (ticket_id),
  INDEX idx_deleted_tickets_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Delete rule of every foreign key from a child table to tickets, BEFORE.
SELECT 'before' AS stage, k.TABLE_NAME AS child, rc.CONSTRAINT_NAME AS fk, rc.DELETE_RULE AS delete_rule
  FROM information_schema.KEY_COLUMN_USAGE k
  JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
    ON rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND rc.TABLE_NAME = k.TABLE_NAME
 WHERE k.TABLE_SCHEMA = @dbname AND k.REFERENCED_TABLE_NAME = 'tickets' AND k.COLUMN_NAME = 'ticket_id'
   AND k.TABLE_NAME IN ('reports', 'attachments', 'audit_logs', 'tenders', 'bills', 'ticket_messages', 'notifications')
 ORDER BY k.TABLE_NAME;

-- reports: drop a ticket key whose delete rule is not CASCADE ...
SET @fk = (SELECT k.CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE k
             JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
               ON rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND rc.TABLE_NAME = k.TABLE_NAME
            WHERE k.TABLE_SCHEMA = @dbname AND k.TABLE_NAME = 'reports' AND k.COLUMN_NAME = 'ticket_id'
              AND k.REFERENCED_TABLE_NAME = 'tickets' AND rc.DELETE_RULE <> 'CASCADE' LIMIT 1);
SET @s = IF(@fk IS NULL, 'SELECT 1', CONCAT('ALTER TABLE reports DROP FOREIGN KEY `', @fk, '`'));
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
-- ... and add the CASCADE key when the column now has none.
SET @has = (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'reports' AND COLUMN_NAME = 'ticket_id' AND REFERENCED_TABLE_NAME = 'tickets');
SET @s = IF(@has > 0, 'SELECT 1',
  'ALTER TABLE reports ADD CONSTRAINT fk_reports_ticket_cascade FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- attachments: drop a ticket key whose delete rule is not CASCADE ...
SET @fk = (SELECT k.CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE k
             JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
               ON rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND rc.TABLE_NAME = k.TABLE_NAME
            WHERE k.TABLE_SCHEMA = @dbname AND k.TABLE_NAME = 'attachments' AND k.COLUMN_NAME = 'ticket_id'
              AND k.REFERENCED_TABLE_NAME = 'tickets' AND rc.DELETE_RULE <> 'CASCADE' LIMIT 1);
SET @s = IF(@fk IS NULL, 'SELECT 1', CONCAT('ALTER TABLE attachments DROP FOREIGN KEY `', @fk, '`'));
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
-- ... and add the CASCADE key when the column now has none.
SET @has = (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'attachments' AND COLUMN_NAME = 'ticket_id' AND REFERENCED_TABLE_NAME = 'tickets');
SET @s = IF(@has > 0, 'SELECT 1',
  'ALTER TABLE attachments ADD CONSTRAINT fk_attachments_ticket_cascade FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- audit_logs: drop a ticket key whose delete rule is not CASCADE ...
SET @fk = (SELECT k.CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE k
             JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
               ON rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND rc.TABLE_NAME = k.TABLE_NAME
            WHERE k.TABLE_SCHEMA = @dbname AND k.TABLE_NAME = 'audit_logs' AND k.COLUMN_NAME = 'ticket_id'
              AND k.REFERENCED_TABLE_NAME = 'tickets' AND rc.DELETE_RULE <> 'CASCADE' LIMIT 1);
SET @s = IF(@fk IS NULL, 'SELECT 1', CONCAT('ALTER TABLE audit_logs DROP FOREIGN KEY `', @fk, '`'));
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
-- ... and add the CASCADE key when the column now has none.
SET @has = (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'ticket_id' AND REFERENCED_TABLE_NAME = 'tickets');
SET @s = IF(@has > 0, 'SELECT 1',
  'ALTER TABLE audit_logs ADD CONSTRAINT fk_audit_logs_ticket_cascade FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- tenders: drop a ticket key whose delete rule is not CASCADE ...
SET @fk = (SELECT k.CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE k
             JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
               ON rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND rc.TABLE_NAME = k.TABLE_NAME
            WHERE k.TABLE_SCHEMA = @dbname AND k.TABLE_NAME = 'tenders' AND k.COLUMN_NAME = 'ticket_id'
              AND k.REFERENCED_TABLE_NAME = 'tickets' AND rc.DELETE_RULE <> 'CASCADE' LIMIT 1);
SET @s = IF(@fk IS NULL, 'SELECT 1', CONCAT('ALTER TABLE tenders DROP FOREIGN KEY `', @fk, '`'));
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
-- ... and add the CASCADE key when the column now has none.
SET @has = (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tenders' AND COLUMN_NAME = 'ticket_id' AND REFERENCED_TABLE_NAME = 'tickets');
SET @s = IF(@has > 0, 'SELECT 1',
  'ALTER TABLE tenders ADD CONSTRAINT fk_tenders_ticket_cascade FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- bills: drop a ticket key whose delete rule is not CASCADE ...
SET @fk = (SELECT k.CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE k
             JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
               ON rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND rc.TABLE_NAME = k.TABLE_NAME
            WHERE k.TABLE_SCHEMA = @dbname AND k.TABLE_NAME = 'bills' AND k.COLUMN_NAME = 'ticket_id'
              AND k.REFERENCED_TABLE_NAME = 'tickets' AND rc.DELETE_RULE <> 'CASCADE' LIMIT 1);
SET @s = IF(@fk IS NULL, 'SELECT 1', CONCAT('ALTER TABLE bills DROP FOREIGN KEY `', @fk, '`'));
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
-- ... and add the CASCADE key when the column now has none.
SET @has = (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'bills' AND COLUMN_NAME = 'ticket_id' AND REFERENCED_TABLE_NAME = 'tickets');
SET @s = IF(@has > 0, 'SELECT 1',
  'ALTER TABLE bills ADD CONSTRAINT fk_bills_ticket_cascade FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ticket_messages: drop a ticket key whose delete rule is not CASCADE ...
SET @fk = (SELECT k.CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE k
             JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
               ON rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND rc.TABLE_NAME = k.TABLE_NAME
            WHERE k.TABLE_SCHEMA = @dbname AND k.TABLE_NAME = 'ticket_messages' AND k.COLUMN_NAME = 'ticket_id'
              AND k.REFERENCED_TABLE_NAME = 'tickets' AND rc.DELETE_RULE <> 'CASCADE' LIMIT 1);
SET @s = IF(@fk IS NULL, 'SELECT 1', CONCAT('ALTER TABLE ticket_messages DROP FOREIGN KEY `', @fk, '`'));
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
-- ... and add the CASCADE key when the column now has none.
SET @has = (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'ticket_messages' AND COLUMN_NAME = 'ticket_id' AND REFERENCED_TABLE_NAME = 'tickets');
SET @s = IF(@has > 0, 'SELECT 1',
  'ALTER TABLE ticket_messages ADD CONSTRAINT fk_ticket_messages_ticket_cascade FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- notifications: drop a ticket key whose delete rule is not CASCADE ...
SET @fk = (SELECT k.CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE k
             JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
               ON rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND rc.TABLE_NAME = k.TABLE_NAME
            WHERE k.TABLE_SCHEMA = @dbname AND k.TABLE_NAME = 'notifications' AND k.COLUMN_NAME = 'ticket_id'
              AND k.REFERENCED_TABLE_NAME = 'tickets' AND rc.DELETE_RULE <> 'CASCADE' LIMIT 1);
SET @s = IF(@fk IS NULL, 'SELECT 1', CONCAT('ALTER TABLE notifications DROP FOREIGN KEY `', @fk, '`'));
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
-- ... and add the CASCADE key when the column now has none.
SET @has = (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'ticket_id' AND REFERENCED_TABLE_NAME = 'tickets');
SET @s = IF(@has > 0, 'SELECT 1',
  'ALTER TABLE notifications ADD CONSTRAINT fk_notifications_ticket_cascade FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Delete rule of every foreign key from a child table to tickets, AFTER.
SELECT 'after' AS stage, k.TABLE_NAME AS child, rc.CONSTRAINT_NAME AS fk, rc.DELETE_RULE AS delete_rule
  FROM information_schema.KEY_COLUMN_USAGE k
  JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
    ON rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND rc.TABLE_NAME = k.TABLE_NAME
 WHERE k.TABLE_SCHEMA = @dbname AND k.REFERENCED_TABLE_NAME = 'tickets' AND k.COLUMN_NAME = 'ticket_id'
   AND k.TABLE_NAME IN ('reports', 'attachments', 'audit_logs', 'tenders', 'bills', 'ticket_messages', 'notifications')
 ORDER BY k.TABLE_NAME;
