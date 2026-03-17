DELETE FROM admin_sessions;
DELETE FROM admin_credentials;
DELETE FROM user_sessions;
DELETE FROM users;
DELETE FROM translation_chapters;
DELETE FROM translations;
DELETE FROM chapters;
DELETE FROM books;
DELETE FROM app_settings;

INSERT INTO books (
    id,
    slug,
    title,
    author,
    original_language,
    description,
    cover_image_url,
    created_at,
    updated_at
) VALUES (
    'book_iliad',
    'iliad',
    'The Iliad',
    'Attributed to Homer',
    'Ancient Greek',
    'A seeded sample used to validate metadata, D1 access, and R2 chapter retrieval.',
    NULL,
    '2026-03-06T00:00:00.000Z',
    '2026-03-06T00:00:00.000Z'
);

INSERT INTO chapters (
    id,
    book_id,
    slug,
    position,
    title,
    created_at,
    updated_at
) VALUES (
    'chapter_iliad_book_1',
    'book_iliad',
    'book-1-the-rage',
    1,
    'Book 1: The Rage',
    '2026-03-06T00:00:00.000Z',
    '2026-03-06T00:00:00.000Z'
);

INSERT INTO translations (
    id,
    book_id,
    slug,
    name,
    description,
    provider,
    model,
    thinking_level,
    prompt,
    context_before_chapter_count,
    context_after_chapter_count,
    status,
    published_at,
    created_at,
    updated_at
) VALUES (
    'translation_verse_meaning',
    'book_iliad',
    'verse-meaning',
    'Verse / Preserve Meaning',
    'A sample translation variant that groups multiple source lines into larger reading passages.',
    'google',
    'gemini-3-flash-preview',
    NULL,
    'Translate into contemporary English while preserving the emotional and poetic force of the original.',
    1,
    1,
    'published',
    '2026-03-06T00:00:00.000Z',
    '2026-03-06T00:00:00.000Z',
    '2026-03-06T00:00:00.000Z'
);

INSERT INTO translation_chapters (
    id,
    translation_id,
    chapter_id,
    status,
    error_message,
    created_at,
    updated_at
) VALUES (
    'translation_chapter_iliad_book_1',
    'translation_verse_meaning',
    'chapter_iliad_book_1',
    'saved',
    NULL,
    '2026-03-06T00:00:00.000Z',
    '2026-03-06T00:00:00.000Z'
);

INSERT INTO app_settings (key, value, updated_at) VALUES
    ('openrouter_api_key', '', '2026-03-06T00:00:00.000Z'),
    ('google_api_key', '', '2026-03-06T00:00:00.000Z'),
    ('default_provider', 'google', '2026-03-06T00:00:00.000Z'),
    ('default_model', 'gemini-3-flash-preview', '2026-03-06T00:00:00.000Z'),
    ('default_prompt', 'You are preparing a bilingual reading edition for Ancient Epics. Split the source chapter into paired bilingual chunks that preserve all source content. Return JSON only with this shape: {"chapterTitle": string, "notes": string, "chunks": [{"originalText": string, "translatedText": string, "type": "verse" | "prose"}]}. The concatenation of all originalText values must exactly reproduce the source chapter without dropping or duplicating content.', '2026-03-06T00:00:00.000Z');
