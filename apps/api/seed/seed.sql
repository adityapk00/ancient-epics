DELETE FROM translation_jobs;
DELETE FROM notes;
DELETE FROM users;
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
    status,
    published_at
) VALUES (
    'book_iliad',
    'iliad',
    'The Iliad',
    'Attributed to Homer',
    'Ancient Greek',
    'A seeded sample used to validate metadata, D1 access, and R2 chapter retrieval during Phase 0.',
    NULL,
    'published',
    '2026-03-06T00:00:00.000Z'
);

INSERT INTO chapters (
    id,
    book_id,
    slug,
    position,
    title,
    is_preview,
    source_r2_key,
    status,
    published_at
) VALUES (
    'chapter_iliad_book_1',
    'book_iliad',
    'book-1-the-rage',
    1,
    'Book 1: The Rage',
    1,
    'epics/iliad/book-1-the-rage/original.json',
    'published',
    '2026-03-06T00:00:00.000Z'
);

INSERT INTO translations (
    id,
    book_id,
    slug,
    name,
    description,
    ai_system_prompt,
    output_r2_prefix,
    status,
    published_at
) VALUES (
    'translation_verse_meaning',
    'book_iliad',
    'verse-meaning',
    'Verse / Preserve Meaning',
    'A sample translation variant matching the README chunk contract.',
    'Translate into contemporary English while preserving the emotional and poetic force of the original.',
    'epics/iliad/book-1-the-rage/translations',
    'published',
    '2026-03-06T00:00:00.000Z'
);

INSERT INTO users (
    id,
    email,
    stripe_customer_id,
    subscription_status,
    role
) VALUES (
    'user_admin_seed',
    'admin@example.com',
    NULL,
    'active',
    'admin'
);

-- Seed default app settings
INSERT INTO app_settings (key, value) VALUES
    ('openrouter_api_key', ''),
    ('default_translation_model', 'openai/gpt-4o');
