CREATE TABLE analytics_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL CHECK (event_type IN ('signup_completed', 'book_view', 'chapter_view', 'translation_view')),
    event_date TEXT NOT NULL,
    occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    book_slug TEXT,
    translation_slug TEXT,
    chapter_slug TEXT,
    country TEXT,
    region TEXT,
    city TEXT
);

CREATE INDEX idx_analytics_events_type_date ON analytics_events(event_type, event_date);
CREATE INDEX idx_analytics_events_book_slug ON analytics_events(book_slug);
CREATE INDEX idx_analytics_events_translation_slug ON analytics_events(translation_slug);
CREATE INDEX idx_analytics_events_country ON analytics_events(country);
