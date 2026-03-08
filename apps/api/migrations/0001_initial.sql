-- ============================================================
-- Ancient Epics – Phase 1 Schema
-- ============================================================
 
CREATE TABLE books (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    author TEXT,
    original_language TEXT,
    description TEXT,
    cover_image_url TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TEXT
);

CREATE TABLE chapters (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id),
    slug TEXT NOT NULL,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    is_preview INTEGER NOT NULL DEFAULT 0,
    source_r2_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TEXT,
    UNIQUE(book_id, slug),
    UNIQUE(book_id, position)
);

CREATE TABLE translations (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id),
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    ai_system_prompt TEXT,
    output_r2_prefix TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'ready', 'published', 'failed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TEXT,
    UNIQUE(book_id, slug)
);

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    stripe_customer_id TEXT,
    subscription_status TEXT NOT NULL DEFAULT 'free' CHECK (subscription_status IN ('free', 'trial', 'active', 'expired')),
    role TEXT NOT NULL DEFAULT 'reader' CHECK (role IN ('reader', 'admin')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    book_id TEXT NOT NULL REFERENCES books(id),
    chapter_id TEXT NOT NULL REFERENCES chapters(id),
    translation_id TEXT NOT NULL REFERENCES translations(id),
    anchor_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE translation_jobs (
    id TEXT PRIMARY KEY,
    translation_id TEXT NOT NULL REFERENCES translations(id),
    chapter_id TEXT NOT NULL REFERENCES chapters(id),
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'failed', 'completed')),
    started_at TEXT,
    completed_at TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Key/value store for application-wide settings.
-- Used for: openrouter_api_key, default_translation_model, etc.
CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE admin_ingestion_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source_mode TEXT NOT NULL CHECK (source_mode IN ('paste', 'existing_story')),
    source_book_slug TEXT,
    translation_id TEXT REFERENCES translations(id),
    provider TEXT NOT NULL DEFAULT 'google' CHECK (provider IN ('google', 'openrouter')),
    model TEXT NOT NULL,
    thinking_level TEXT CHECK (thinking_level IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh')),
    prompt TEXT NOT NULL,
    context_before_chapter_count INTEGER NOT NULL DEFAULT 1,
    context_after_chapter_count INTEGER NOT NULL DEFAULT 1,
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

CREATE INDEX idx_books_slug ON books(slug);
CREATE INDEX idx_books_status ON books(status);
CREATE INDEX idx_chapters_book_position ON chapters(book_id, position);
CREATE INDEX idx_chapters_status ON chapters(status);
CREATE INDEX idx_translations_book_slug ON translations(book_id, slug);
CREATE INDEX idx_translations_status ON translations(status);
CREATE INDEX idx_notes_user_location ON notes(user_id, book_id, chapter_id);
CREATE INDEX idx_translation_jobs_status ON translation_jobs(status);
CREATE INDEX idx_admin_ingestion_sessions_updated_at ON admin_ingestion_sessions(updated_at DESC);
CREATE INDEX idx_admin_ingestion_sessions_translation_id ON admin_ingestion_sessions(translation_id);
CREATE INDEX idx_admin_ingestion_chapters_session_position ON admin_ingestion_chapters(session_id, position);
