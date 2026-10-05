-- ============================================================
-- Migration 012 — tender lifecycle, resolve, wider amounts (Master-plan Phase 5)
--
--   tickets.status        + TECHNICAL_EVALUATION, FINANCIAL_EVALUATION, TENDER_CANCELLED
--                         (WORK_IN_PROGRESS is shown as "Awarded", WORK_COMPLETED as "Resolved":
--                          no stored value is renamed, so no row needs migrating)
--   tickets.resolved_from_status / resolved_at   where a resolved ticket came from
--   tenders.bid_end_date                         the "End Date" ("Created Date" is published_date)
--   tenders.status        + TECHNICAL_EVALUATION, FINANCIAL_EVALUATION  (EVALUATION stays for old rows)
--   tenders.cancel_reason
--   audit_logs.action     + TECH_EVALUATION, FIN_EVALUATION, TENDER_CANCELLED, RESOLVED, SENT_BACK
--   amounts               DECIMAL(10,2) -> DECIMAL(15,2): estimates, award value, bills, limits
--                         (an award above about Rs 10 crore did not fit before)
--   financial_limits      + DEAN_HIGH_VALUE (the Dean's "high value" tab, was hardcoded 200000)
--
-- SAFE BY CONSTRUCTION: every ENUM change only ADDS values, widening a DECIMAL never loses data,
-- new columns are nullable, every statement is guarded or idempotent: the file is re-runnable.
-- ============================================================

USE deanery_infra;

SET @dbname = DATABASE();

ALTER TABLE tickets
  MODIFY COLUMN status ENUM(
    'UNASSIGNED','ASSIGNED_TO_JE','PENDING_AE_APPROVAL','PENDING_SE_APPROVAL',
    'PENDING_DEAN_APPROVAL','PENDING_DIRECTOR_APPROVAL','APPROVED_FOR_TENDERING',
    'TENDER_PUBLISHED','TECHNICAL_EVALUATION','FINANCIAL_EVALUATION','TENDER_CANCELLED',
    'WORK_IN_PROGRESS','WORK_COMPLETED',
    'RETURNED_TO_JE','DENIED','CLOSED'
  ) NOT NULL DEFAULT 'ASSIGNED_TO_JE';

ALTER TABLE tenders
  MODIFY COLUMN status ENUM(
    'PUBLISHED','EVALUATION','TECHNICAL_EVALUATION','FINANCIAL_EVALUATION','AWARDED','CANCELLED'
  ) DEFAULT 'PUBLISHED';

ALTER TABLE audit_logs
  MODIFY COLUMN action ENUM(
    'CREATED','ASSIGNED','REASSIGNED','REMINDER_SENT','SUBMITTED','FORWARDED',
    'APPROVED','CHANGES_REQUESTED','REJECTED','TENDER_PUBLISHED','WORK_AWARDED',
    'WORK_COMPLETED','WORK_REOPENED','BILL_RECORDED','BILL_UPDATED','CLOSED','OVERRIDE',
    'PASSED','RETURNED','DENIED',
    'TECH_EVALUATION','FIN_EVALUATION','TENDER_CANCELLED','RESOLVED','SENT_BACK'
  ) NOT NULL;

SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'resolved_from_status') > 0, "SELECT 1", "ALTER TABLE tickets ADD COLUMN resolved_from_status VARCHAR(40) NULL"));
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'resolved_at') > 0, "SELECT 1", "ALTER TABLE tickets ADD COLUMN resolved_at DATETIME NULL"));
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tenders' AND COLUMN_NAME = 'bid_end_date') > 0, "SELECT 1", "ALTER TABLE tenders ADD COLUMN bid_end_date DATE NULL"));
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tenders' AND COLUMN_NAME = 'cancel_reason') > 0, "SELECT 1", "ALTER TABLE tenders ADD COLUMN cancel_reason TEXT NULL"));
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

ALTER TABLE reports          MODIFY COLUMN estimated_amount DECIMAL(15,2) NOT NULL;
ALTER TABLE tenders          MODIFY COLUMN work_order_value DECIMAL(15,2) NULL;
ALTER TABLE bills            MODIFY COLUMN gross_amount     DECIMAL(15,2) NOT NULL;
ALTER TABLE bills            MODIFY COLUMN deductions       DECIMAL(15,2) NULL DEFAULT 0.00;
ALTER TABLE bills            MODIFY COLUMN net_amount       DECIMAL(15,2) NOT NULL;
ALTER TABLE financial_limits MODIFY COLUMN max_amount       DECIMAL(15,2) NOT NULL;

INSERT IGNORE INTO financial_limits (`key`, max_amount) VALUES ('DEAN_HIGH_VALUE', 200000.00);
