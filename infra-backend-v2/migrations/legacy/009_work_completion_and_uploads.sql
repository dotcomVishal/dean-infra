-- ============================================================
-- Migration 009 — work completion + applicant verification, uploads by every desk
--
--   tickets.status              + WORK_COMPLETED  (JE marked work done; the
--                                 applicant is reminded until they confirm)
--   audit_logs.action           + WORK_REOPENED   (applicant says work not done)
--   attachments.document_category
--                               + DESK_DOC  (AE/SE/Dean/Director/Sysadmin files,
--                                            readable by every staff desk incl. JE)
--                               + WORK_DOC  (JE execution / completion files,
--                                            readable by staff AND the applicant)
--
-- SAFE BY CONSTRUCTION: every ENUM change only ADDS values; re-runnable.
-- ============================================================

USE deanery_infra;

ALTER TABLE tickets
  MODIFY COLUMN status ENUM(
    'UNASSIGNED','ASSIGNED_TO_JE','PENDING_AE_APPROVAL','PENDING_SE_APPROVAL',
    'PENDING_DEAN_APPROVAL','PENDING_DIRECTOR_APPROVAL','APPROVED_FOR_TENDERING',
    'TENDER_PUBLISHED','WORK_IN_PROGRESS','WORK_COMPLETED',
    'RETURNED_TO_JE','DENIED','CLOSED'
  ) NOT NULL DEFAULT 'ASSIGNED_TO_JE';

ALTER TABLE audit_logs
  MODIFY COLUMN action ENUM(
    'CREATED','ASSIGNED','REASSIGNED','REMINDER_SENT','SUBMITTED','FORWARDED',
    'APPROVED','CHANGES_REQUESTED','REJECTED','TENDER_PUBLISHED','WORK_AWARDED',
    'WORK_COMPLETED','WORK_REOPENED','BILL_RECORDED','BILL_UPDATED','CLOSED','OVERRIDE',
    'PASSED','RETURNED','DENIED'
  ) NOT NULL;

ALTER TABLE attachments
  MODIFY COLUMN document_category ENUM(
    'APPLICANT_EVIDENCE','JE_SITE_PHOTO','JE_ESTIMATE_DOC','CLERK_TENDER_DOC',
    'FINANCE_SANCTION','AUTHORITY_REMARKS','DESK_DOC','WORK_DOC'
  ) NOT NULL DEFAULT 'APPLICANT_EVIDENCE';
