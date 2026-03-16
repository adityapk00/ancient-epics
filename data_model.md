# Data Model Reference

This document describes the data model that exists in the current simplified codebase. It is meant as a quick onboarding map for how data is stored, loaded, edited, and published.

## Mental Model

There are only two persistent stores:

- `D1` holds metadata and admin workspace state.
- `R2` holds canonical source chapter text and published translation chapter JSON.

Details:

- Source chapters are stored once in R2 as plain full-text documents.
- Translation drafts live in D1 inside `translation_chapters.content_json`.
- Published translations are copied to R2 so the reader can load them directly.
 

## Storage Split

### D1

D1 contains five tables:

- `books`
- `chapters`
- `translations`
- `translation_chapters`
- `app_settings`

### R2

R2 contains JSON documents under the `epics/` prefix:

- Original chapter text: `epics/{bookSlug}/{chapterSlug}/original.json`
- Published translation chapter: `epics/{bookSlug}/{chapterSlug}/translations/{translationSlug}.json`

When a book is deleted, the API deletes `epics/{bookSlug}/...` from R2 and removes the book row from D1. Cascading foreign keys remove related chapters, translations, and translation chapter rows.

When a translation is deleted or unpublished, the API deletes its published R2 chapter files. Draft data in D1 is preserved on unpublish and removed on delete.

## D1 Schema

The schema is defined in [0001_initial.sql](/home/adityapk/github/ancient-epics/apps/api/migrations/0001_initial.sql).

### `books`

Top-level work metadata.

- `id TEXT PRIMARY KEY`
- `slug TEXT NOT NULL UNIQUE`
- `title TEXT NOT NULL`
- `author TEXT`
- `original_language TEXT`
- `description TEXT`
- `cover_image_url TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Notes:

- There is no persisted book `status`.
- A book is considered public only if it has at least one published translation.
- Public book queries compute `publishedAt` as `MAX(translations.published_at)`; that value is not stored on the `books` table.

### `chapters`

Chapter metadata for a book.

- `id TEXT PRIMARY KEY`
- `book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE`
- `slug TEXT NOT NULL`
- `position INTEGER NOT NULL`
- `title TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Constraints:

- `UNIQUE(book_id, slug)`
- `UNIQUE(book_id, position)`

Notes:

- This table does not store source text.
- The canonical source text is loaded from the chapter's R2 `original.json`.

### `translations`

Translation-level metadata and publishing state for a book.

- `id TEXT PRIMARY KEY`
- `book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE`
- `slug TEXT NOT NULL`
- `name TEXT NOT NULL`
- `description TEXT`
- `provider TEXT NOT NULL CHECK (provider IN ('google', 'openrouter'))`
- `model TEXT NOT NULL`
- `thinking_level TEXT CHECK (thinking_level IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh'))`
- `prompt TEXT NOT NULL`
- `context_before_chapter_count INTEGER NOT NULL DEFAULT 1`
- `context_after_chapter_count INTEGER NOT NULL DEFAULT 1`
- `status TEXT NOT NULL CHECK (status IN ('draft', 'published'))`
- `published_at TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Constraint:

- `UNIQUE(book_id, slug)`

Notes:

- `draft` means admin-only.
- `published` means the translation is reader-visible and its saved chapter documents should exist in R2.
- Publishing does not create a second draft copy; the same normalized content in `translation_chapters.content_json` is written out to R2.

### `translation_chapters`

Per-chapter admin workspace state for a translation.

- `id TEXT PRIMARY KEY`
- `translation_id TEXT NOT NULL REFERENCES translations(id) ON DELETE CASCADE`
- `chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE`
- `status TEXT NOT NULL CHECK (status IN ('empty', 'draft', 'saved', 'error'))`
- `raw_response TEXT`
- `content_json TEXT`
- `notes TEXT`
- `error_message TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Constraint:

- `UNIQUE(translation_id, chapter_id)`

Status meanings:

- `empty`: placeholder row created when the translation is created.
- `draft`: parsed successfully from a model/import/manual edit, but not yet explicitly saved for publish.
- `saved`: parsed successfully and considered ready to publish.
- `error`: the last save/generate attempt failed normalization or parsing.

Important behavior:

- One `translation_chapters` row exists for every `(translation, chapter)` pair.
- `raw_response` is the exact JSON text returned by the model or entered by the admin editor.
- `content_json` stores the normalized `TranslationChapterDocument`.
- `notes` is extracted from the raw response JSON, not entered separately in D1.
- Reader APIs do not use this table directly; admin APIs do.

### `app_settings`

Simple key/value settings used by the admin UI and generation endpoints.

- `key TEXT PRIMARY KEY`
- `value TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Current well-known keys from shared types:

- `openrouter_api_key`
- `google_api_key`
- `default_provider`
- `default_model`
- `default_prompt`

## R2 Documents

R2 path helpers live in [r2.ts](/home/adityapk/github/ancient-epics/packages/shared/src/r2.ts).

### `OriginalChapterDocument`

Stored at `epics/{bookSlug}/{chapterSlug}/original.json`.

```json
{
  "bookSlug": "iliad",
  "chapterSlug": "book-1-the-rage",
  "fullText": "Sing, goddess, the rage..."
}
```

Notes:

- This is the only persisted source-text representation.
- There is no source chunk table or source chunk JSON format.

### `TranslationChapterDocument`

Stored in two places:

- In D1 `translation_chapters.content_json` for draft/admin state
- In R2 `epics/{bookSlug}/{chapterSlug}/translations/{translationSlug}.json` for published reader state

```json
{
  "translationSlug": "verse-meaning",
  "chunks": [
    {
      "id": "t1",
      "type": "verse",
      "originalText": "Sing, goddess, the rage...",
      "translatedText": "O goddess, sing Achilles' rage...",
      "ordinal": 1
    }
  ]
}
```

Chunk fields:

- `id`: assigned by the app during normalization, typically `t1`, `t2`, ...
- `type`: `"prose"` or `"verse"`
- `originalText`: the source slice for this chunk
- `translatedText`: the translated slice
- `ordinal`: 1-based display/order field

Important invariant:

- The concatenation of all chunk `originalText` values should reconstruct the full chapter source text. Validation warns if it does not.

## Shared Runtime Types

The API and frontend share their contract via [types.ts](/home/adityapk/github/ancient-epics/packages/shared/src/types.ts).

The most important runtime shapes are:

- `BookSummary`: public/admin book list item
- `BookDetail`: book metadata plus `chapters` and visible `translations`
- `TranslationSummary`: lightweight translation metadata
- `ReaderChapterPayload`: source chapter plus optional published translation content
- `AdminBookSourcePayload`: full book metadata plus source chapter text for admin views
- `AdminTranslationSummary`: translation metadata plus chapter counts
- `AdminTranslationDetail`: translation metadata plus full `TranslationChapterDraft[]`
- `TranslationDraftArchive`: export/import format for translation drafts

## Data Flow

### 1. Book creation

When an admin creates a book:

1. A `books` row is inserted.
2. A `chapters` row is inserted for each normalized chapter.
3. An `OriginalChapterDocument` is written to R2 for each chapter.

Source text never goes into D1 directly.

### 2. Translation creation

When an admin creates a translation:

1. A `translations` row is inserted with `status = 'draft'`.
2. The API creates one `translation_chapters` row per source chapter.
3. Each row starts as `status = 'empty'` with no content.

### 3. Generation or manual save

When a chapter is generated or manually saved:

1. The model or editor provides `raw_response` JSON.
2. The API normalizes that JSON into a `TranslationChapterDocument`.
3. On success, D1 stores:
   - `raw_response`
   - `content_json`
   - `notes`
   - `status = 'draft'` or `status = 'saved'`
4. On failure, D1 stores:
   - `raw_response`
   - `error_message`
   - `status = 'error'`

Drafts are not written to R2.

### 4. Publish

When an admin publishes a translation:

1. Every chapter is ensured to have normalized saved content.
2. Validation checks that required fields exist and chunk source text reconstructs the chapter source.
3. Each chapter's `TranslationChapterDocument` is written to R2.
4. The `translations` row is updated to `status = 'published'`.

The reader experience depends on those R2 translation files existing.

### 5. Unpublish

When an admin unpublishes a translation:

1. Published translation chapter files are deleted from R2.
2. The `translations` row is set back to `status = 'draft'`.
3. Draft chapter data in `translation_chapters` remains intact.

### 6. Reader load path

Reader endpoints work like this:

1. Query D1 for the book/chapter/translation metadata.
2. Load source text from the chapter `original.json` in R2.
3. If a translation slug is requested and published, load the published translation JSON from R2.
4. Return a `ReaderChapterPayload`.

Reader APIs never read unpublished draft content from `translation_chapters`.

### 7. Admin load path

Admin endpoints work like this:

1. Query D1 for books, chapters, translations, and translation chapter rows.
2. Load source text from each chapter's `original.json`.
3. Parse `translation_chapters.content_json` into `TranslationChapterDocument` when present.
4. Return admin payloads that combine D1 metadata with R2 source text.

## Import / Export Format

The current archive format is `TranslationDraftArchive` with `version: 2`.

It stores:

- translation metadata
- per-chapter status
- per-chapter `rawResponse`
- per-chapter normalized `content`
- per-chapter `notes`

Imports create a new `translations` row plus fresh `translation_chapters` rows, then replay the archived chapter state into those rows.

The import code still accepts some legacy session-shaped payloads, but the canonical format now is `TranslationDraftArchive`.

## What No Longer Exists

If you see older docs or assumptions, ignore these concepts unless they are reintroduced in code:

- `users`
- `notes`
- `translation_jobs`
- `admin_ingestion_sessions`
- `admin_ingestion_chapters`
- book-level persisted publish state
- chapter-level persisted source chunking
- draft translations stored in R2
