CREATE TABLE admin_ingestion_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source_mode TEXT NOT NULL CHECK (source_mode IN ('paste', 'existing_story')),
    source_book_slug TEXT,
    model TEXT NOT NULL,
    prompt TEXT NOT NULL,
    current_chapter_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE admin_ingestion_chapters (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES admin_ingestion_sessions(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    source_text TEXT NOT NULL,
    source_chapter_slug TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generated', 'saved', 'error')),
    raw_response TEXT,
    original_document_json TEXT,
    translation_document_json TEXT,
    notes TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(session_id, position)
);

CREATE INDEX idx_admin_ingestion_sessions_updated_at
    ON admin_ingestion_sessions(updated_at DESC);

CREATE INDEX idx_admin_ingestion_chapters_session_position
    ON admin_ingestion_chapters(session_id, position);