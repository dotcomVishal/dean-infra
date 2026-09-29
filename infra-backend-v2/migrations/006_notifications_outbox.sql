-- ============================================================
-- Migration 006 — Notifications outbox + reminders (plan.md §3.4, §4 Phase 5)
--
-- One table serves two jobs:
--   kind = 'EMAIL'    one-shot mail, written in the same transaction as the
--                     workflow move that caused it, sent (and retried with
--                     backoff) by the worker in src/cron/emailReminders.js.
--   kind = 'REMINDER' a recurring reminder to a desk. The row stays PENDING
--                     and its next_due_at moves forward after every send until
--                     the ticket leaves stop_when_status_not_in.
--
-- Times are written by the application (JS Date parameters), never NOW(), so
-- the worker can be driven by a fake clock in tests.
--
-- SAFE BY CONSTRUCTION: CREATE TABLE IF NOT EXISTS only; nothing existing is
-- altered.
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT NULL,
  to_user_id INT NOT NULL,
  kind ENUM('EMAIL','REMINDER') NOT NULL DEFAULT 'EMAIL',
  audience ENUM('STAFF','APPLICANT') NOT NULL DEFAULT 'STAFF',
  desk VARCHAR(20) NULL,
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  status ENUM('PENDING','SENT','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  next_due_at DATETIME NOT NULL,
  anchor_at DATETIME NULL,
  reminder_no INT NOT NULL DEFAULT 0,
  stop_when_status_not_in VARCHAR(255) NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error VARCHAR(500) NULL,
  locked_until DATETIME NULL,
  sent_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (to_user_id) REFERENCES users(id),
  INDEX idx_notifications_due (status, next_due_at),
  INDEX idx_notifications_ticket (ticket_id, kind, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- PROVE IT WORKED ------------------------------------------------------------
SELECT COLUMN_NAME, COLUMN_TYPE
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications'
 ORDER BY ORDINAL_POSITION;
