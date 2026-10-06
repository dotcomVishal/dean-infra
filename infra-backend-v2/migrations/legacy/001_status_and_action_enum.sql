-- ============================================================
-- Migration 001 — enforce the workflow vocabulary at the DB layer
--
-- Fixes:
--   S1  tickets.status is VARCHAR(50), so ANY string is accepted.
--       This is what let a JE write 'APPROVED_FOR_TENDERING' directly
--       and skip AE / SE / Dean / Director entirely.
--   +   audit_logs.action is missing 'SUBMITTED', which workflow.js
--       emits the moment a JE files a report. That INSERT would fail.
--
-- Run with:
--   mysql -u root -p deanery_infra < migrations/001_status_and_action_enum.sql
--
-- SAFE BY CONSTRUCTION: step 1 preserves every current value, so even if
-- step 3's repair guesses wrong you can restore from _migration_backup_*.
-- This matters because ALTER TABLE cannot be rolled back in MySQL.
--
-- SKIP THIS FILE ENTIRELY if inspect-status.mjs told you there is no
-- `tickets` table -- go straight to 6d and load schema.sql fresh.
-- ============================================================

-- 1. SAFETY NET -------------------------------------------------------------
-- INSERT IGNORE makes this re-runnable: a second run won't die on duplicate
-- primary keys, it just skips rows already backed up.
CREATE TABLE IF NOT EXISTS _migration_backup_tickets_status (
  ticket_id    INT PRIMARY KEY,
  old_status   VARCHAR(255),
  backed_up_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
INSERT IGNORE INTO _migration_backup_tickets_status (ticket_id, old_status)
  SELECT id, status FROM tickets;

CREATE TABLE IF NOT EXISTS _migration_backup_audit_action (
  audit_id     INT PRIMARY KEY,
  old_action   VARCHAR(255),
  backed_up_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
INSERT IGNORE INTO _migration_backup_audit_action (audit_id, old_action)
  SELECT id, action FROM audit_logs;

-- 2. SHOW WHAT IS ABOUT TO BE REWRITTEN -------------------------------------
-- READ THIS OUTPUT. If it lists rows you did not expect, stop and think
-- before continuing. Once step 4 runs there is no undo.
SELECT 'will be rewritten -> ASSIGNED_TO_JE' AS note, id, status
  FROM tickets
 WHERE status IS NULL OR status NOT IN (
   'ASSIGNED_TO_JE','PENDING_AE_APPROVAL','PENDING_SE_APPROVAL',
   'PENDING_DEAN_APPROVAL','PENDING_DIRECTOR_APPROVAL','APPROVED_FOR_TENDERING',
   'RETURNED_TO_JE','DENIED','CLOSED');

-- 3. REPAIR -----------------------------------------------------------------
-- Explicit mappings FIRST, catch-all LAST. If your inspect output showed a
-- value with an obvious correct meaning, add a line for it here.
UPDATE tickets SET status = 'APPROVED_FOR_TENDERING'
 WHERE status = 'APPROVED FOR TENDERING';   -- spaces instead of underscores

-- Catch-all: anything still unrecognisable goes back to the start of the
-- queue so a human re-triages it. Deliberately conservative -- it is far
-- better to re-inspect one ticket than to mark unreviewed work as sanctioned.
UPDATE tickets SET status = 'ASSIGNED_TO_JE'
 WHERE status IS NULL OR status NOT IN (
   'ASSIGNED_TO_JE','PENDING_AE_APPROVAL','PENDING_SE_APPROVAL',
   'PENDING_DEAN_APPROVAL','PENDING_DIRECTOR_APPROVAL','APPROVED_FOR_TENDERING',
   'RETURNED_TO_JE','DENIED','CLOSED');

UPDATE audit_logs SET action = 'PASSED'
 WHERE action IS NULL OR action NOT IN
   ('CREATED','ASSIGNED','SUBMITTED','PASSED','APPROVED','RETURNED','DENIED');

-- 4. THE ACTUAL MIGRATION ---------------------------------------------------
ALTER TABLE tickets
  MODIFY COLUMN status ENUM(
    'ASSIGNED_TO_JE','PENDING_AE_APPROVAL','PENDING_SE_APPROVAL',
    'PENDING_DEAN_APPROVAL','PENDING_DIRECTOR_APPROVAL','APPROVED_FOR_TENDERING',
    'RETURNED_TO_JE','DENIED','CLOSED'
  ) NOT NULL DEFAULT 'ASSIGNED_TO_JE';

ALTER TABLE audit_logs
  MODIFY COLUMN action ENUM(
    'CREATED','ASSIGNED','SUBMITTED','PASSED','APPROVED','RETURNED','DENIED'
  ) NOT NULL;

-- 5. PROVE IT WORKED --------------------------------------------------------
-- Both columns must now report enum(...):
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND ((TABLE_NAME = 'tickets'    AND COLUMN_NAME = 'status')
     OR (TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'action'));

-- Must be 0. An ENUM stores '' at index 0 when given an invalid value,
-- so any blanked row shows up here:
SELECT COUNT(*) AS blanked_rows FROM tickets WHERE status = '';

-- How many rows did step 3 deliberately rewrite? Compare against step 2.
SELECT COUNT(*) AS rewritten
  FROM _migration_backup_tickets_status b JOIN tickets t ON t.id = b.ticket_id
 WHERE b.old_status <> t.status;

-- 6. PROVE THE DB NOW REJECTS GARBAGE (this SHOULD error) -------------------
-- Run these two by hand afterwards, not as part of the script:
--   INSERT INTO tickets (applicant_id, department, description, status)
--     VALUES (1,'Civil','enum test','BANANA');
--   -> ERROR 1265 (or 1406): Data truncated for column 'status'
-- That error is the S1 hole closing at the storage layer.