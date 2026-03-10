DROP INDEX IF EXISTS idx_chapters_status;

ALTER TABLE chapters DROP COLUMN status;
