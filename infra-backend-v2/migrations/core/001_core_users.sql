-- Shared identity for every InfraSeva module: one row per person.
-- Interim shape (role columns still here); Phase D moves them to mnt_members.
CREATE TABLE IF NOT EXISTS core_users (
  `id` int NOT NULL AUTO_INCREMENT,
  `firebase_uid` varchar(128) NOT NULL,
  `name` varchar(100) NOT NULL,
  `email` varchar(100) NOT NULL,
  `role` enum('APPLICANT','JE','AE','SE','DEAN','DIRECTOR','SYSADMIN','CLERICAL','ACCOUNTANT') NOT NULL,
  `department` enum('Civil','Electrical','Horticulture','Administration','General') NOT NULL,
  `campus` enum('NORTH','SOUTH','BOTH') DEFAULT NULL,
  `last_assigned_at` datetime DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `is_demo` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `firebase_uid` (`firebase_uid`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_role_dept` (`role`,`department`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
