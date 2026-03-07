ALTER TABLE admin_ingestion_sessions
    ADD COLUMN translation_id TEXT REFERENCES translations(id);

ALTER TABLE admin_ingestion_sessions
    ADD COLUMN context_before_chapter_count INTEGER NOT NULL DEFAULT 1;

ALTER TABLE admin_ingestion_sessions
    ADD COLUMN context_after_chapter_count INTEGER NOT NULL DEFAULT 1;

CREATE INDEX idx_admin_ingestion_sessions_translation_id
    ON admin_ingestion_sessions(translation_id);