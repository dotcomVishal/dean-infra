-- Migration 007 — routing scopes the earlier backfill missed (bugs_erros A1/A6).
--   1. Any JE/AE/SE that has a campus but no scope row gets their primary scope.
--   2. Each Civil AE also runs Horticulture for the same campus
--      (staffDetails.md "additional charge"), so Horticulture tickets have an AE
--      without needing scripts/seed-staff.mjs.
-- Re-runnable: INSERT IGNORE on the (user_id, department, campus) unique key.

INSERT IGNORE INTO user_scopes (user_id, department, campus)
  SELECT id, department, campus FROM users
   WHERE role IN ('JE','AE','SE') AND campus IS NOT NULL;

INSERT IGNORE INTO user_scopes (user_id, department, campus)
  SELECT id, 'Horticulture', campus FROM users
   WHERE role = 'AE' AND department = 'Civil' AND campus IS NOT NULL;
