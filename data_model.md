# Data Model Reference

This document describes the current Ancient Epics data model as implemented in this repo.

## Overview

- Cloudflare D1 stores relational metadata, publication state, notes, and admin workflow state.
- Cloudflare R2 stores chapter JSON documents for original texts and published or saved translations.
- Original chapters are stored as a single canonical `fullText` document per chapter.
- Translation chapters own their own chunking. There is no shared canonical source-chunk table.

## Storage Responsibilities

### D1

D1 stores these tables:

- `books`
- `chapters`
- `translations`
- `users`
- `notes`
- `translation_jobs`
- `app_settings`
- `admin_ingestion_sessions`
- `admin_ingestion_chapters`

### R2

R2 stores:

- original chapter documents at `epics/{bookSlug}/{chapterSlug}/original.json`
- translation chapter documents at `epics/{bookSlug}/{chapterSlug}/translations/{translationSlug}.json`

Deleting a book or translation removes the corresponding D1 rows and deletes the related R2 objects.

## Current D1 Schema

### `books`

Top-level works.

- `id TEXT PRIMARY KEY`
- `slug TEXT NOT NULL UNIQUE`
- `title TEXT NOT NULL`
- `author TEXT`
- `original_language TEXT`
- `description TEXT`
- `cover_image_url TEXT`
- `status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published'))`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `published_at TEXT`

Notes:

- Book `status` is derived operationally from whether at least one translation is published.
- `published_at` is set when the book first becomes published and cleared when no translations remain published.

### `chapters`

Book chapter metadata.

- `id TEXT PRIMARY KEY`
- `book_id TEXT NOT NULL REFERENCES books(id)`
- `slug TEXT NOT NULL`
- `position INTEGER NOT NULL`
- `title TEXT NOT NULL`
- `is_preview INTEGER NOT NULL DEFAULT 0`
- `source_r2_key TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `published_at TEXT`

Constraints:

- `UNIQUE(book_id, slug)`
- `UNIQUE(book_id, position)`

Important: chapters no longer have a `status` column. Migration `0002_remove_chapter_status.sql` removed it.

### `translations`

Named translation variants for a book.

- `id TEXT PRIMARY KEY`
- `book_id TEXT NOT NULL REFERENCES books(id)`
- `slug TEXT NOT NULL`
- `name TEXT NOT NULL`
- `description TEXT`
- `ai_system_prompt TEXT`
- `output_r2_prefix TEXT NOT NULL`
- `status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'ready', 'published', 'failed'))`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `published_at TEXT`

Constraints:

- `UNIQUE(book_id, slug)`

Notes:

- `ready` is the persisted non-public state used by the admin UI after generation or manual import.
- `published` exposes the translation to reader endpoints.
- Setting a published translation back to `ready` unpublishes it.

### `users`

- `id TEXT PRIMARY KEY`
- `email TEXT NOT NULL UNIQUE`
- `stripe_customer_id TEXT`
- `subscription_status TEXT NOT NULL DEFAULT 'free' CHECK (subscription_status IN ('free', 'trial', 'active', 'expired'))`
- `role TEXT NOT NULL DEFAULT 'reader' CHECK (role IN ('reader', 'admin'))`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

### `notes`

User notes anchored to a translation chunk.

- `id TEXT PRIMARY KEY`
- `user_id TEXT NOT NULL REFERENCES users(id)`
- `book_id TEXT NOT NULL REFERENCES books(id)`
- `chapter_id TEXT NOT NULL REFERENCES chapters(id)`
- `translation_id TEXT NOT NULL REFERENCES translations(id)`
- `anchor_id TEXT NOT NULL`
- `content TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Notes:

- `translation_id` is required.
- `anchor_id` points to a translation-local chunk id like `t1`, `t2`, etc.

### `translation_jobs`

Background translation job bookkeeping.

- `id TEXT PRIMARY KEY`
- `translation_id TEXT NOT NULL REFERENCES translations(id)`
- `chapter_id TEXT NOT NULL REFERENCES chapters(id)`
- `status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'failed', 'completed'))`
- `started_at TEXT`
- `completed_at TEXT`
- `error_message TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

This table exists in the schema but is not the primary workflow used by the current admin UI, which runs through `admin_ingestion_sessions` and `admin_ingestion_chapters`.

### `app_settings`

Application-wide settings.

- `key TEXT PRIMARY KEY`
- `value TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Current well-known keys in shared types:

- `openrouter_api_key`
- `google_api_key`
- `default_translation_model`
- `admin_ingestion_provider`
- `admin_ingestion_model`
- `admin_ingestion_prompt`

### `admin_ingestion_sessions`

Admin translation run metadata. A session can be tied to a translation or be standalone.

- `id TEXT PRIMARY KEY`
- `title TEXT NOT NULL`
- `source_mode TEXT NOT NULL CHECK (source_mode IN ('paste', 'existing_story'))`
- `source_book_slug TEXT`
- `translation_id TEXT REFERENCES translations(id)`
- `provider TEXT NOT NULL DEFAULT 'google' CHECK (provider IN ('google', 'openrouter'))`
- `model TEXT NOT NULL`
- `thinking_level TEXT CHECK (thinking_level IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh'))`
- `prompt TEXT NOT NULL`
- `context_before_chapter_count INTEGER NOT NULL DEFAULT 1`
- `context_after_chapter_count INTEGER NOT NULL DEFAULT 1`
- `current_chapter_index INTEGER NOT NULL DEFAULT 0`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Notes:

- The current admin translation workspace uses one active session per translation.
- Exported translation JSON from the admin UI is currently the serialized `AdminIngestionSessionDetail`, not `TranslationExportArchive`.

### `admin_ingestion_chapters`

Per-session working chapter state.

- `id TEXT PRIMARY KEY`
- `session_id TEXT NOT NULL REFERENCES admin_ingestion_sessions(id) ON DELETE CASCADE`
- `position INTEGER NOT NULL`
- `title TEXT NOT NULL`
- `slug TEXT NOT NULL`
- `source_text TEXT NOT NULL`
- `source_chapter_slug TEXT`
- `status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generated', 'saved', 'error'))`
- `raw_response TEXT`
- `original_document_json TEXT`
- `translation_document_json TEXT`
- `notes TEXT`
- `error_message TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Constraint:

- `UNIQUE(session_id, position)`

Notes:

- `raw_response` stores the raw model JSON or imported JSON payload.
- `original_document_json` stores a normalized `OriginalChapterDocument`.
- `translation_document_json` stores a normalized `TranslationChapterDocument`.
- `saved` means the normalized chapter was successfully persisted and, for translation sessions, written to R2.

## R2 Document Schemas

### `OriginalChapterDocument`

Stored at `epics/{bookSlug}/{chapterSlug}/original.json`.

```json
{
  "bookSlug": "iliad",
  "chapterSlug": "book-1-the-rage",
  "fullText": "Full chapter source text..."
}
```

Notes:

- `fullText` is the canonical source text for the chapter.
- Original chapter documents do not define canonical chunk boundaries.

### `TranslationChapterDocument`

Stored at `epics/{bookSlug}/{chapterSlug}/translations/{translationSlug}.json`.

```json
{
  "translationSlug": "verse-meaning",
  "chunks": [
    {
      "id": "t1",
      "type": "verse",
      "originalText": "Source passage text...",
      "translatedText": "Rendered translation text...",
      "ordinal": 1
    }
  ]
}
```

Notes:

- Chunking is translation-owned.
- Different translations may split the same chapter differently.
- Each chunk carries both the source passage and the translated passage.
- Chunk ids are translation-local and are used for note anchors.

## Shared TypeScript Shapes

Canonical shared types live in [types.ts](/home/adityapk/github/ancient-epics/packages/shared/src/types.ts).

Important shapes:

- `OriginalChapterDocument`
- `TranslationChapterDocument`
- `TranslationChunk`
- `BookSummary`
- `ChapterSummary`
- `TranslationSummary`
- `AdminIngestionSessionDetail`
- `AdminIngestionChapterRecord`
- `AdminTranslationValidationPayload`
- `BookExportArchive`
- `TranslationExportArchive`

## Creation, Generation, Import, and Publish Flow

### Book creation

When a book is created:

1. A row is inserted into `books`.
2. A row is inserted into `chapters` for each staged chapter.
3. Each chapter gets an R2 `original.json` document with canonical `fullText`.

### Translation creation

When a translation is created:

1. A row is inserted into `translations` with status `draft`.
2. A matching `admin_ingestion_session` is created from the book's chapters.
3. Each chapter begins in `pending`.

### Translation generation

The generation prompt requires this JSON shape:

```json
{
  "chapterTitle": "string",
  "notes": "string",
  "chunks": [
    {
      "originalText": "string",
      "translatedText": "string",
      "type": "verse"
    }
  ]
}
```

Normalization rules in the API:

- the app assigns chunk `id` values as `t1`, `t2`, etc.
- the app assigns `ordinal`
- missing `type` values are inferred from the source text
- normalized `OriginalChapterDocument` and `TranslationChapterDocument` are written into `admin_ingestion_chapters`
- when a chapter is saved for a translation-backed session, the normalized `TranslationChapterDocument` is written to R2

### Translation import

The admin import endpoint currently accepts an exported `AdminIngestionSessionDetail` payload.

During import:

- a fresh translation row is created
- a fresh admin session is created for the target book
- imported chapter content is matched onto the target book's chapter list
- stale ids are discarded
- `sourceBookSlug`, `translationSlug`, chapter-local chunk ids, and normalized documents are regenerated against the target book/translation

### Publishing

Publishing a translation:

1. materializes all saved translation chapter documents into R2
2. sets the translation status to `published`
3. updates the parent book status to `published`

Unpublishing a translation:

- sets the translation back to `ready`
- clears `published_at` for that translation
- re-synchronizes the parent book status based on whether any translations remain published

## Validation

Current translation validation checks:

- `originalDocument.fullText` exists
- the translation has at least one chunk
- each chunk has non-empty `originalText`
- each chunk has non-empty `translatedText`
- concatenating all chunk `originalText` values reconstructs the chapter `fullText`

This catches dropped, duplicated, or reordered source text during generation or manual editing.

## Admin UI Model

The admin translation workspace edits one paired chunk list per chapter:

- one row per translation chunk
- left side edits `originalText`
- right side edits `translatedText`
- one `type` per row

The raw JSON editor uses the same shape expected from generation and import repair:

```json
{
  "chapterTitle": "string",
  "notes": "string",
  "chunks": [
    {
      "originalText": "string",
      "translatedText": "string",
      "type": "prose"
    }
  ]
}
```

## Important Consequences

- There is no canonical original chunk list shared across translations.
- Cross-translation alignment is not based on source chunk ids.
- Original passage boundaries are defined per translation.
- Notes are stable only within a specific translation, not across all translations.
- The admin session tables are not just temporary scratch state; they are the working source of truth for draft and ready translation workflows.
