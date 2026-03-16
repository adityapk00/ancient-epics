-- ============================================================
-- Ancient Epics – Simplified Schema
-- ============================================================

CREATE TABLE books (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    author TEXT,
    original_language TEXT,
    description TEXT,
    cover_image_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE chapters (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(book_id, slug),
    UNIQUE(book_id, position)
);

CREATE TABLE translations (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    provider TEXT NOT NULL DEFAULT 'google' CHECK (provider IN ('google', 'openrouter')),
    model TEXT NOT NULL,
    thinking_level TEXT CHECK (thinking_level IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh')),
    prompt TEXT NOT NULL,
    context_before_chapter_count INTEGER NOT NULL DEFAULT 1,
    context_after_chapter_count INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    published_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(book_id, slug)
);

CREATE TABLE translation_chapters (
    id TEXT PRIMARY KEY,
    translation_id TEXT NOT NULL REFERENCES translations(id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'empty' CHECK (status IN ('empty', 'draft', 'saved', 'error')),
    raw_response TEXT,
    content_json TEXT,
    notes TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(translation_id, chapter_id)
);

CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_books_slug ON books(slug);
CREATE INDEX idx_chapters_book_position ON chapters(book_id, position);
CREATE INDEX idx_translations_book_slug ON translations(book_id, slug);
CREATE INDEX idx_translations_status ON translations(status);
CREATE INDEX idx_translation_chapters_translation_id ON translation_chapters(translation_id);
CREATE INDEX idx_translation_chapters_status ON translation_chapters(status);
