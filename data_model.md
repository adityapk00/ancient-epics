# Data Model

This document describes the data model that exists in the current simplified codebase.

There are only two persistent stores:

- `D1` holds metadata and workflow state.
- `R2` holds all chapter-sized content payloads.

Details:

- Source chapters are stored once in R2 as plain full-text documents.
- Translation chapter raw JSON is stored in R2 at all times, including draft editing.
- Published reader responses are normalized from those R2 chapter objects at request time.

## Storage Split

### Metadata (D1)

D1 contains eight tables:

1. `books`: Registry of all epic poems.
2. `chapters`: The structural chapters/books of an epic.
3. `translations`: Translation metadata (name, provider, model, prompt).
4. `translation_chapters`: Per-chapter admin status and error state.
5. `app_settings`: Global AI provider keys and default model choice.
6. `users`: Public readers.
7. `user_sessions`: Auth sessions for readers.
8. `admin_credentials` / `admin_sessions`: Password hash and session tracking for the admin workspace.

### Content (R2)

R2 contains JSON documents under the `epics/` prefix:

- Original chapter text: `epics/{bookSlug}/{chapterSlug}/original.json`
- Translation chapter raw JSON: `epics/{bookSlug}/{chapterSlug}/translations/{translationSlug}.json`

When a book is deleted, the API deletes `epics/{bookSlug}/...` from R2 and removes the book row from D1. Cascading foreign keys remove related chapters, translations, and translation chapter rows.

When a translation is deleted, the API deletes its translation chapter objects from R2. Unpublish now only flips D1 metadata back to `draft`; the R2 content stays in place.

## D1 Schema

### `books`

- `id TEXT PRIMARY KEY`
- `slug TEXT UNIQUE` (e.g., `iliad`)
- `title TEXT`
- `author TEXT`
- `original_language TEXT`
- `description TEXT`
- `cover_image_url TEXT`
- `created_at TEXT`
- `updated_at TEXT`

### `chapters`

- `id TEXT PRIMARY KEY`
- `book_id TEXT REFERENCES books(id)`
- `slug TEXT` (e.g., `book-1-the-rage`)
- `position INTEGER`
- `title TEXT`
- `created_at TEXT`
- `updated_at TEXT`

Unique Constraint: `(book_id, slug)` and `(book_id, position)`.

### `translations`

- `id TEXT PRIMARY KEY`
- `book_id TEXT REFERENCES books(id)`
- `slug TEXT` (e.g., `verse-meaning`)
- `name TEXT`
- `description TEXT`
- `provider TEXT` (e.g., `google`, `openrouter`)
- `model TEXT` (e.g., `gemini-3-flash-preview`)
- `thinking_level TEXT` (e.g., `high`)
- `prompt TEXT` (Full system prompt template)
- `context_before_chapter_count INTEGER`
- `context_after_chapter_count INTEGER`
- `access_level TEXT` (`public`, `loggedin`)
- `status TEXT` (`draft`, `published`)
- `published_at TEXT`
- `created_at TEXT`
- `updated_at TEXT`

Constraint: `(book_id, slug)` is unique.

Notes:

- `draft` means admin-only.
- `published` means the translation is reader-visible.
- Publishing is now metadata-only. It validates the existing R2 chapter payloads and flips the `translations.status` flag.

### `translation_chapters`

Per-chapter admin workspace state for a translation.

- `id TEXT PRIMARY KEY`
- `translation_id TEXT NOT NULL REFERENCES translations(id) ON DELETE CASCADE`
- `chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE`
- `status TEXT NOT NULL CHECK (status IN ('empty', 'draft', 'saved', 'error'))`
- `error_message TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Unique Constraint: `(translation_id, chapter_id)`.

Status meanings:

- `empty`: placeholder row created when the translation is created.
- `draft`: parsed successfully from a model/import/manual edit, but not yet explicitly saved for publish.
- `saved`: parsed successfully and considered ready to publish.
- `error`: the last save/generate attempt failed normalization or parsing.

Important behavior:

- One `translation_chapters` row exists for every `(translation, chapter)` pair.
- This table stores metadata only: chapter status, last error, and timestamps.
- Reader and admin APIs both load chapter content from R2.

### `app_settings`

Simple key/value settings used by the admin UI and generation endpoints.

- `key TEXT PRIMARY KEY`
- `value TEXT`
- `updated_at TEXT`

Keys:

- `openrouter_api_key`
- `google_api_key`
- `default_provider`
- `default_model`
- `default_prompt`

## R2 Documents

### `OriginalChapterDocument`

Stored at `epics/{bookSlug}/{chapterSlug}/original.json`.

```json
{
  "bookSlug": "iliad",
  "chapterSlug": "book-1-the-rage",
  "fullText": "Sing, goddess, the rage of Achilles..."
}
```

Notes:

- This is the only persisted source-text representation.
- There is no source chunk table or source chunk JSON format.

### Translation Chapter Raw JSON

Stored once in R2 at `epics/{bookSlug}/{chapterSlug}/translations/{translationSlug}.json`.

This is the editable raw JSON entered by the admin editor or returned by the model:

```json
{
  "chapterTitle": "Book 1: The Rage",
  "notes": "",
  "chunks": [
    {
      "type": "verse",
      "originalText": "Sing, goddess, the rage...",
      "translatedText": "O goddess, sing Achilles' rage..."
    }
  ]
}
```

The API normalizes that raw JSON into a `TranslationChapterDocument` for admin responses, validation, and reader payloads.

Chunk fields:

- `id`: assigned by the app during normalization, typically `t1`, `t2`, ...
- `type`: `prose` or `verse` (defaulting to `verse`).
- `ordinal`: derived from order in the array.
- `originalText`: the source text for this chunk.
- `translatedText`: the translated text for this chunk.

## Key Workflows

### 1. Book Creation

When an admin creates a book, they provide a series of source chapters (title + slug + text).

1. The API creates a `books` row.
2. For each chapter, the API creates a `chapters` row.
3. For each chapter, the API writes an `OriginalChapterDocument` to R2.

### 2. Translation Creation

When an admin creates a translation:

1. The API creates a `translations` row.
2. The API creates one `translation_chapters` row for every chapter in the book with `status = 'empty'`.

### 3. Chapter Generation / Manual Edit

When a chapter is generated or manually saved:

1. The model or editor provides `raw_response` JSON.
2. The API writes that raw JSON to the chapter's R2 translation object.
3. The API normalizes the raw JSON to validate it.
4. On success, D1 stores only metadata:
   - `status = 'draft'` or `status = 'saved'`
   - cleared `error_message`
5. On failure, D1 stores only metadata:
   - `error_message`
   - `status = 'error'`
6. If the translation had already been published, the save moves it back to `draft` so the reader does not serve in-progress edits.

### 4. Publish

When an admin publishes a translation:

1. Every chapter is ensured to have saved raw JSON in R2.
2. Validation checks that required fields exist and chunk source text reconstructs the chapter source.
3. The `translations` row is updated to `status = 'published'`.

The reader experience depends on those R2 translation files already existing.

### 5. Unpublish

When an admin unpublishes a translation:

1. The `translations` row is set back to `status = 'draft'`.
2. Translation chapter files remain in R2 for later editing or republishing.

### 6. Reader load path

Reader endpoints work like this:

1. Query D1 for the book/chapter/translation metadata.
2. Load source text from the chapter `original.json` in R2.
3. If a translation slug is requested and published, load the translation raw JSON from R2 and normalize it.
4. Return a `ReaderChapterPayload`.

Reader APIs never read unpublished draft content from D1.

### 7. Admin load path

Admin endpoints work like this:

1. Query D1 for books, chapters, translations, and translation chapter rows.
2. Load source text from each chapter's `original.json`.
3. Load each chapter's translation raw JSON from R2 and normalize it when present.
4. Return admin payloads that combine D1 metadata with R2 source text.

## Import / Export Format

The admin UI allows exporting a translation as a single JSON file.

The current archive format is `TranslationDraftArchive`.

It stores:

- translation metadata
- per-chapter status
- per-chapter `rawResponse`
- per-chapter normalized `content`
- per-chapter `notes`

Imports create a new `translations` row plus fresh `translation_chapters` rows, then replay the archived chapter state into those rows.
