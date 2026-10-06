-- Shared identity for every InfraSeva module: one row per person, whichever
-- module they use. Identity only: roles live in each module's own members
-- table (mnt_members for the maintenance module). No row there = default role.
--
-- is_active is account-wide: FALSE blocks the person in EVERY module. A module
-- that wants to block someone only in itself clears its own members.is_active.
-- Rows are never deleted, only deactivated; module tables hold foreign keys to them.
CREATE TABLE IF NOT EXISTS core_users (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  firebase_uid VARCHAR(128) NOT NULL UNIQUE,
  name         VARCHAR(100) NOT NULL,
  email        VARCHAR(100) NOT NULL UNIQUE,
  phone        VARCHAR(20)  NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  is_demo      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
