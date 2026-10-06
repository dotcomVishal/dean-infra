-- HTML part of each queued mail. Nullable: rows queued before this migration still send, as text only.
-- MySQL 8.0 has no ADD COLUMN IF NOT EXISTS, so the statement is guarded to stay safe to re-run.
SET @add_body_html = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE mnt_notifications ADD COLUMN body_html MEDIUMTEXT NULL AFTER body',
    'DO 0')
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mnt_notifications' AND COLUMN_NAME = 'body_html');
PREPARE add_body_html FROM @add_body_html;
EXECUTE add_body_html;
DEALLOCATE PREPARE add_body_html;
