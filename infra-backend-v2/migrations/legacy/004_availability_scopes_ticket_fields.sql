-- ============================================================
-- Migration 004 — Campus, Availability & Assignment (plan.md §4 Phase 3)
--
-- Adds:
--   - user_scopes        (multi department/campus scope per JE/AE/SE, §3.1)
--   - user_availability   (JE/AE leave windows, §3.1)
--   - users.last_assigned_at   (round-robin tiebreak, §3.2 step 2)
--   - tickets.building/landmark/lat/lng/category/contact_phone (§3.1)
--   - tickets.status gains 'UNASSIGNED' (§3.2 step 4)
--
-- SAFE BY CONSTRUCTION: every new column is nullable, every new table is
-- additive, and the status ENUM change only ADDS a value -- every existing
-- row keeps its current status. Guarded the same way as migrations 002/003
-- so this file is re-runnable by hand; the migration runner also tracks it.
--
-- Run with:
--   node scripts/migrate.mjs
-- ============================================================

USE deanery_infra;
SET @dbname = DATABASE();

-- 1. user_scopes — a JE/AE/SE can cover more than one (department, campus)
--    pair (for example the North Civil AE also carries Horticulture, North).
--    users.department/users.campus stay as the primary scope for existing
--    scope checks (untouched in this phase); this table is what
--    services/assignment.js queries.
CREATE TABLE IF NOT EXISTS user_scopes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  department ENUM('Civil','Electrical','Horticulture','Administration','General') NOT NULL,
  campus ENUM('NORTH','SOUTH','BOTH') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_user_scope (user_id, department, campus),
  INDEX idx_scope_dept_campus (department, campus)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill: every JE/AE/SE with a department+campus already set gets their
-- current single scope carried over, so assignment works immediately even
-- before scripts/seed-staff.mjs is re-run.
INSERT IGNORE INTO user_scopes (user_id, department, campus)
  SELECT id, department, campus FROM users
   WHERE role IN ('JE','AE','SE') AND campus IS NOT NULL;

-- 2. user_availability — JE/AE leave windows. Available = no row covers
--    NOW() (checked in services/assignment.js). Deleting a row = ending
--    leave early / removing a mistaken entry.
CREATE TABLE IF NOT EXISTS user_availability (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  start_at DATETIME NOT NULL,
  end_at DATETIME NOT NULL,
  reason VARCHAR(255) NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_availability_user_window (user_id, start_at, end_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. users.last_assigned_at — round-robin tiebreak when two JEs have the
--    same open-ticket count (plan.md §3.2 step 2).
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND COLUMN_NAME = 'last_assigned_at'
  ) > 0,
  "SELECT 1",
  "ALTER TABLE users ADD COLUMN last_assigned_at DATETIME NULL AFTER campus"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 4. tickets — new Raise Ticket form fields (§3.1, §4 Phase 3 item 1).
--    All nullable at the DB layer: zod enforces "required" at the
--    application boundary (src/validation/ticketValidation.js), the same
--    split already used for campus/priority in migration 003.
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'building') > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD COLUMN building VARCHAR(150) NULL AFTER campus"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'landmark') > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD COLUMN landmark VARCHAR(255) NULL AFTER building"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'lat') > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD COLUMN lat DECIMAL(9,6) NULL AFTER landmark"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'lng') > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD COLUMN lng DECIMAL(9,6) NULL AFTER lat"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'category') > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD COLUMN category VARCHAR(50) NULL AFTER lng"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'contact_phone') > 0,
  "SELECT 1",
  "ALTER TABLE tickets ADD COLUMN contact_phone VARCHAR(20) NULL AFTER category"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 5. tickets.status gains 'UNASSIGNED' — the pool-exhausted / all-on-leave
--    fallback (plan.md Q8). Adding a value to an ENUM is always additive:
--    every existing row's status is untouched.
ALTER TABLE tickets
  MODIFY COLUMN status ENUM(
    'UNASSIGNED','ASSIGNED_TO_JE','PENDING_AE_APPROVAL','PENDING_SE_APPROVAL',
    'PENDING_DEAN_APPROVAL','PENDING_DIRECTOR_APPROVAL','APPROVED_FOR_TENDERING',
    'TENDER_PUBLISHED','WORK_IN_PROGRESS',
    'RETURNED_TO_JE','DENIED','CLOSED'
  ) NOT NULL DEFAULT 'ASSIGNED_TO_JE';

-- 6. PROVE IT WORKED ---------------------------------------------------------
SELECT COUNT(*) AS user_scopes_table_exists
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_scopes';

SELECT COUNT(*) AS user_availability_table_exists
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_availability';

SELECT department, campus, COUNT(*) AS scopes FROM user_scopes GROUP BY department, campus ORDER BY department, campus;

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND ((TABLE_NAME = 'users' AND COLUMN_NAME = 'last_assigned_at')
     OR (TABLE_NAME = 'tickets' AND COLUMN_NAME IN ('building','landmark','lat','lng','category','contact_phone')));

SELECT COLUMN_TYPE FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'status';
