# Data Model Reference

> This document is a technical deep-dive into the data model powering Ancient Epics.
> It is intended to get new engineers productive as quickly as possible — covering what every entity is, where it lives, and how data flows through the system during content ingestion and translation.

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [Core Domain Concepts](#2-core-domain-concepts)
3. [Storage Layers — D1 vs R2](#3-storage-layers--d1-vs-r2)
4. [D1 Schema (Relational Data)](#4-d1-schema-relational-data)
5. [R2 Object Layout (Content Payloads)](#5-r2-object-layout-content-payloads)
6. [R2 Document Schemas (JSON)](#6-r2-document-schemas-json)
7. [Shared TypeScript Types](#7-shared-typescript-types)
8. [Book Ingestion Lifecycle](#8-book-ingestion-lifecycle)
9. [Translation Lifecycle](#9-translation-lifecycle)
10. [Status State Machines](#10-status-state-machines)
11. [Key Helper Functions](#11-key-helper-functions)
12. [Export / Import Archives](#12-export--import-archives)

---

## 1. High-Level Architecture

```
┌──────────────┐      ┌──────────────────┐      ┌──────────────┐
│   React +    │ ──►  │  Cloudflare      │ ──►  │ Cloudflare   │
│   Vite       │ /api │  Worker (Hono)   │      │ D1 (SQLite)  │
│   Frontend   │ ◄──  │  apps/api/       │ ──►  │              │
└──────────────┘      └──────────────────┘      └──────────────┘
                              │
                              │  JSON read/write
                              ▼
                      ┌──────────────────┐
                      │  Cloudflare R2   │
                      │  (Object Store)  │
                      └──────────────────┘
```

- **D1** stores queryable relational metadata: books, chapters, translations, users, notes, app settings, and admin ingestion workflow state.
- **R2** stores immutable JSON content payloads: original chapter text (chunked) and translation chapter text (chunked).
- **The shared package** (`packages/shared/`) exports TypeScript types and R2 key-building utilities used by both the API and the frontend.

---

## 2. Core Domain Concepts

### Book

A **Book** is the top-level content entity — a single ancient text (e.g., _The Iliad_, _Epic of Gilgamesh_).

| Property           | Purpose                                             |
| ------------------ | --------------------------------------------------- |
| `slug`             | URL-safe identifier, e.g. `iliad`                   |
| `title`            | Human-readable name                                 |
| `author`           | Attribution (nullable, e.g. "Attributed to Homer")  |
| `originalLanguage` | Language of the source text (e.g. "Ancient Greek")  |
| `status`           | `draft` or `published` — controls reader visibility |

A Book has many **Chapters** and many **Translations**.

### Chapter

A **Chapter** represents one section/book/canto of the original work (e.g., "Book 1: The Rage").

| Property      | Purpose                                                       |
| ------------- | ------------------------------------------------------------- |
| `slug`        | URL-safe, unique within its book (e.g. `book-1-the-rage`)     |
| `position`    | Integer ordering within the book (1-indexed, unique per book) |
| `isPreview`   | Whether this chapter is available to free-tier users          |
| `sourceR2Key` | The full R2 object key pointing to `original.json`            |
| `status`      | `draft` or `published`                                        |

The actual text content of a chapter is **not** stored in D1. It lives in R2 as a JSON document of ordered chunks (see [R2 Document Schemas](#6-r2-document-schemas-json)).

### Translation

A **Translation** is a named variant of how the book's text should be rendered in the target language. One book can have many translations, each with a different style (e.g., "Verse — Preserve Meaning", "Modern Prose", "Atmosphere-First").

| Property         | Purpose                                                             |
| ---------------- | ------------------------------------------------------------------- |
| `slug`           | URL-safe, unique within its book (e.g. `verse-meaning`)             |
| `name`           | Human-readable label                                                |
| `aiSystemPrompt` | The system prompt used during AI generation                         |
| `outputR2Prefix` | R2 prefix where per-chapter translation JSON files are stored       |
| `status`         | Has 5 states: `draft`, `generating`, `ready`, `published`, `failed` |

A translation does **not** store the translated text in D1. Each chapter's translated text is stored in R2 as a separate JSON file.

### Chunk (TextChunk / TranslationChunk)

**Chunks** are the atomic units of text — a line of verse, a paragraph of prose, a dialogue block. They exist only inside R2 JSON documents and are never stored in D1.

- **`TextChunk`** (original): `{ id, type, text, ordinal }`
- **`TranslationChunk`** (extends TextChunk): adds `sourceChunkIds: string[]` — an ordered list of original chunk IDs that this translation passage covers.

This design allows translations to define their own passage boundaries. A translation chunk can cover one original chunk, or combine several.

### Note

A **Note** is a user annotation anchored to a specific chunk (either in the original or in a translation). It references a book, chapter, optionally a translation, and an `anchorId` pointing to a chunk ID.

### Ingestion Session / Ingestion Chapter

These are admin-only workflow entities used to manage the AI-assisted process of ingesting and translating text. See [Translation Lifecycle](#9-translation-lifecycle) for the full flow.

---

## 3. Storage Layers — D1 vs R2

| Data                                       | Storage | Why                                                                |
| ------------------------------------------ | ------- | ------------------------------------------------------------------ |
| Book, Chapter, Translation **metadata**    | D1      | Needs querying (filter by status, join by book, order by position) |
| User accounts, subscriptions               | D1      | Relational, query-heavy                                            |
| Notes and passage anchors                  | D1      | Per-user, queryable                                                |
| App settings (API keys, default models)    | D1      | Key-value, small, mutable                                          |
| Admin ingestion sessions + chapters        | D1      | Workflow state, needs status tracking                              |
| Original chapter content (chunked JSON)    | R2      | Immutable blob, fetched by key, can be large                       |
| Translation chapter content (chunked JSON) | R2      | Immutable blob, fetched by key, per-chapter per-translation        |
| Static assets (covers, portraits)          | R2      | Binary blobs                                                       |

**Key takeaway:** D1 holds _metadata and state_, R2 holds _content payloads_.

---

## 4. D1 Schema (Relational Data)

> Defined in `apps/api/migrations/0001_initial.sql`

### `books`

```sql
CREATE TABLE books (
    id                TEXT PRIMARY KEY,           -- UUID
    slug              TEXT NOT NULL UNIQUE,
    title             TEXT NOT NULL,
    author            TEXT,
    original_language TEXT,
    description       TEXT,
    cover_image_url   TEXT,
    status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'published')),
    created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at      TEXT
);
```

### `chapters`

```sql
CREATE TABLE chapters (
    id              TEXT PRIMARY KEY,           -- UUID
    book_id         TEXT NOT NULL REFERENCES books(id),
    slug            TEXT NOT NULL,              -- unique within book
    position        INTEGER NOT NULL,          -- 1-indexed ordering
    title           TEXT NOT NULL,
    is_preview      INTEGER NOT NULL DEFAULT 0,-- boolean: free-tier access
    source_r2_key   TEXT NOT NULL,             -- full R2 key to original.json
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'published')),
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at    TEXT,
    UNIQUE(book_id, slug),
    UNIQUE(book_id, position)
);
```

The `source_r2_key` column stores the full R2 object path, e.g. `epics/iliad/book-1-the-rage/original.json`. This is computed via `buildOriginalChapterKey()`.

### `translations`

```sql
CREATE TABLE translations (
    id                TEXT PRIMARY KEY,         -- UUID
    book_id           TEXT NOT NULL REFERENCES books(id),
    slug              TEXT NOT NULL,            -- unique within book
    name              TEXT NOT NULL,
    description       TEXT,
    ai_system_prompt  TEXT,                     -- prompt used for AI generation
    output_r2_prefix  TEXT NOT NULL,            -- R2 prefix for this translation's files
    status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','generating','ready','published','failed')),
    created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at      TEXT,
    UNIQUE(book_id, slug)
);
```

The `output_r2_prefix` is like `epics/iliad/translations/verse-meaning` but per-chapter translation files live at chapter-level paths (see R2 layout below).

### `users`

```sql
CREATE TABLE users (
    id                    TEXT PRIMARY KEY,
    email                 TEXT NOT NULL UNIQUE,
    stripe_customer_id    TEXT,
    subscription_status   TEXT NOT NULL DEFAULT 'free'
                          CHECK (subscription_status IN ('free','trial','active','expired')),
    role                  TEXT NOT NULL DEFAULT 'reader'
                          CHECK (role IN ('reader', 'admin')),
    created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### `notes`

```sql
CREATE TABLE notes (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL REFERENCES users(id),
    book_id          TEXT NOT NULL REFERENCES books(id),
    chapter_id       TEXT NOT NULL REFERENCES chapters(id),
    translation_id   TEXT REFERENCES translations(id),  -- NULL if anchored to original
    anchor_document  TEXT NOT NULL CHECK (anchor_document IN ('original','translation')),
    anchor_id        TEXT NOT NULL,                      -- chunk ID (e.g. "c3" or "t2")
    content          TEXT NOT NULL,
    created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

The `anchor_document` field distinguishes whether the note is pinned to an original chunk or a translation chunk, and `anchor_id` is the chunk's stable ID within the relevant R2 document.

### `translation_jobs`

```sql
CREATE TABLE translation_jobs (
    id               TEXT PRIMARY KEY,
    translation_id   TEXT NOT NULL REFERENCES translations(id),
    chapter_id       TEXT NOT NULL REFERENCES chapters(id),
    status           TEXT NOT NULL CHECK (status IN ('queued','running','failed','completed')),
    started_at       TEXT,
    completed_at     TEXT,
    error_message    TEXT,
    created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### `app_settings`

```sql
CREATE TABLE app_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

A simple key-value table. Current well-known keys:

| Key                         | Purpose                                                      |
| --------------------------- | ------------------------------------------------------------ |
| `openrouter_api_key`        | API key for OpenRouter LLM requests                          |
| `default_translation_model` | Default model for translations (e.g. `openai/gpt-4o`)        |
| `admin_ingestion_model`     | Model used in ingestion sessions (e.g. `openai/gpt-4o-mini`) |
| `admin_ingestion_prompt`    | Default system prompt for ingestion sessions                 |

### `admin_ingestion_sessions`

```sql
CREATE TABLE admin_ingestion_sessions (
    id                           TEXT PRIMARY KEY,
    title                        TEXT NOT NULL,
    source_mode                  TEXT NOT NULL CHECK (source_mode IN ('paste','existing_story')),
    source_book_slug             TEXT,              -- set when source_mode='existing_story'
    translation_id               TEXT REFERENCES translations(id),  -- set for translation sessions
    model                        TEXT NOT NULL,      -- LLM model identifier
    prompt                       TEXT NOT NULL,      -- system prompt for this session
    context_before_chapter_count INTEGER NOT NULL DEFAULT 1,
    context_after_chapter_count  INTEGER NOT NULL DEFAULT 1,
    current_chapter_index        INTEGER NOT NULL DEFAULT 0,  -- progress cursor
    created_at                   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

A session captures the full configuration for a batch ingestion/translation run. It tracks an ordered list of chapters to be processed and the current progress via `current_chapter_index`. The `context_before/after_chapter_count` controls how many neighboring chapters are sent to the LLM for context when generating each chapter.

### `admin_ingestion_chapters`

```sql
CREATE TABLE admin_ingestion_chapters (
    id                       TEXT PRIMARY KEY,
    session_id               TEXT NOT NULL REFERENCES admin_ingestion_sessions(id) ON DELETE CASCADE,
    position                 INTEGER NOT NULL,
    title                    TEXT NOT NULL,
    slug                     TEXT NOT NULL,
    source_text              TEXT NOT NULL,          -- raw input text
    source_chapter_slug      TEXT,                   -- set for existing_story mode
    status                   TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','generated','saved','error')),
    raw_response             TEXT,                   -- raw LLM response
    original_document_json   TEXT,                   -- parsed OriginalChapterDocument JSON
    translation_document_json TEXT,                  -- parsed TranslationChapterDocument JSON
    notes                    TEXT,                   -- AI-generated notes
    error_message            TEXT,
    created_at               TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(session_id, position)
);
```

Each row represents one chapter being processed within a session. The `original_document_json` and `translation_document_json` columns temporarily hold the parsed AI output as JSON strings _before_ the content is committed to R2.

---

## 5. R2 Object Layout (Content Payloads)

All content lives under the `epics/` prefix in the R2 bucket (binding: `CONTENT_BUCKET`).

```
epics/
└── {bookSlug}/
    └── {chapterSlug}/
        ├── original.json                          ← OriginalChapterDocument
        └── translations/
            ├── {translationSlug}.json             ← TranslationChapterDocument
            └── {anotherTranslationSlug}.json
```

### Concrete example (seeded Iliad data):

```
epics/
└── iliad/
    └── book-1-the-rage/
        ├── original.json
        └── translations/
            └── verse-meaning.json
```

### R2 Key Builders

Defined in `packages/shared/src/r2.ts`:

| Function                                                                  | Output                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `buildOriginalChapterKey("iliad", "book-1-the-rage")`                     | `epics/iliad/book-1-the-rage/original.json`                   |
| `buildTranslationChapterKey("iliad", "book-1-the-rage", "verse-meaning")` | `epics/iliad/book-1-the-rage/translations/verse-meaning.json` |
| `buildChapterPrefix("iliad", "book-1-the-rage")`                          | `epics/iliad/book-1-the-rage`                                 |
| `buildTranslationsPrefix("iliad", "book-1-the-rage")`                     | `epics/iliad/book-1-the-rage/translations`                    |

---

## 6. R2 Document Schemas (JSON)

### `OriginalChapterDocument`

Stored at `epics/{bookSlug}/{chapterSlug}/original.json`.

```jsonc
{
  "bookSlug": "iliad",
  "chapterSlug": "book-1-the-rage",
  "chunks": [
    {
      "id": "c1", // stable ID, format: c{ordinal}
      "type": "verse", // "verse" | "prose"
      "text": "Mῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος",
      "ordinal": 1, // 1-indexed position
    },
    {
      "id": "c2",
      "type": "verse",
      "text": "οὐλομένην, ἣ μυρί᾽ Ἀχαιοῖς ἄλγε᾽ ἔθηκε,",
      "ordinal": 2,
    },
    // ...
  ],
}
```

- **Chunk IDs** follow the pattern `c{ordinal}` (e.g., `c1`, `c2`, `c3`).
- **`type`** is either `"verse"` (line-by-line poetry) or `"prose"` (paragraph-level text).
- The chunking heuristic in `buildInitialOriginalDocument()` decides verse vs prose based on line-to-paragraph ratio.

### `TranslationChapterDocument`

Stored at `epics/{bookSlug}/{chapterSlug}/translations/{translationSlug}.json`.

```jsonc
{
  "translationSlug": "verse-meaning",
  "chunks": [
    {
      "id": "t1", // stable ID, format: t{ordinal}
      "type": "verse",
      "text": "Sing, goddess, the wrath of Achilles...",
      "ordinal": 1,
      "sourceChunkIds": ["c1", "c2"], // anchors to original chunks
    },
    {
      "id": "t2",
      "type": "verse",
      "text": "It drove so many valiant souls...",
      "ordinal": 2,
      "sourceChunkIds": ["c3"],
    },
  ],
}
```

- **`sourceChunkIds`** is the critical anchoring mechanism. It's an ordered list of original chunk IDs that this translation passage covers.
- Translations don't need 1:1 chunk parity with the original. A single translation chunk can combine multiple source lines, or a single source chunk can map to multiple translation chunks.
- The **reader** resolves these anchors at render time to display original and translation side-by-side.

---

## 7. Shared TypeScript Types

Defined in `packages/shared/src/types.ts` and re-exported from `packages/shared/src/index.ts`.

### Enums

| Type                          | Values                                                                  | Used On                     |
| ----------------------------- | ----------------------------------------------------------------------- | --------------------------- |
| `ChunkType`                   | `"prose"` \| `"verse"`                                                  | TextChunk, TranslationChunk |
| `ContentStatus`               | `"draft"` \| `"published"`                                              | Books, Chapters             |
| `TranslationStatus`           | `"draft"` \| `"generating"` \| `"ready"` \| `"published"` \| `"failed"` | Translations                |
| `SubscriptionStatus`          | `"free"` \| `"trial"` \| `"active"` \| `"expired"`                      | Users                       |
| `UserRole`                    | `"reader"` \| `"admin"`                                                 | Users                       |
| `AdminIngestionSourceMode`    | `"paste"` \| `"existing_story"`                                         | Ingestion Sessions          |
| `AdminIngestionChapterStatus` | `"pending"` \| `"generated"` \| `"saved"` \| `"error"`                  | Ingestion Chapters          |

### Key Interfaces

| Interface                                 | Purpose                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `TextChunk`                               | A single chunk in an original document (`id`, `type`, `text`, `ordinal`) |
| `TranslationChunk`                        | Extends TextChunk with `sourceChunkIds`                                  |
| `OriginalChapterDocument`                 | The R2 JSON shape for an original chapter                                |
| `TranslationChapterDocument`              | The R2 JSON shape for a translation chapter                              |
| `BookSummary` / `BookDetail`              | Book metadata (Detail includes chapters + translations lists)            |
| `ChapterSummary`                          | Chapter metadata as returned by the API                                  |
| `TranslationSummary`                      | Translation metadata as returned by the API                              |
| `NoteRecord`                              | A user's note anchored to a chunk                                        |
| `AppSetting`                              | Key-value pair from `app_settings` table                                 |
| `AdminIngestionSessionSummary` / `Detail` | Ingestion session metadata and full detail with chapters                 |
| `AdminIngestionChapterRecord`             | One chapter within an ingestion session                                  |
| `BookExportArchive`                       | Portable JSON shape for exporting a book + chapters + chunks             |
| `TranslationExportArchive`                | Portable JSON shape for exporting a translation variant                  |

---

## 8. Book Ingestion Lifecycle

This describes how a new book and its original text enter the system.

### Step 1: Create a Book record

```
POST /api/admin/books
Body: { title, slug?, author?, originalLanguage?, description?, chapters? }
```

1. A UUID is generated for the book `id`.
2. A slug is derived from the title (or provided explicitly).
3. A `books` row is inserted into D1 with `status = 'draft'`.
4. If `chapters` are provided in the body, each chapter is also created:
   - A UUID `id` per chapter.
   - `source_r2_key` is computed as `epics/{bookSlug}/{chapterSlug}/original.json`.
   - An `OriginalChapterDocument` is built via `buildInitialOriginalDocument()` from the raw `sourceText` and written to R2.
   - A `chapters` row is inserted into D1 with `status = 'draft'`.

### Step 2: Chunking the original text

The `buildInitialOriginalDocument()` function handles initial auto-chunking:

1. The raw text is trimmed and normalized.
2. It splits the text into lines (`\n`) and paragraphs (`\n\n`).
3. **Verse detection heuristic:** If line count ≥ 2× paragraph count, treat as verse (one chunk per line). Otherwise, treat as prose (one chunk per paragraph).
4. Each chunk gets a stable ID (`c1`, `c2`, …), a `type` (`verse` or `prose`), and an `ordinal`.
5. The result is written to R2 as `original.json`.

### Step 3: Publishing

1. Admin reviews the chunked original text.
2. Admin sets `status = 'published'` on the book and its chapters.
3. Published books appear on the public reader's library page.

### Where data lives at each stage:

| Stage                     | D1                                               | R2                      |
| ------------------------- | ------------------------------------------------ | ----------------------- |
| Book created              | `books` row (`draft`)                            | —                       |
| Chapter created with text | `chapters` row (`draft`, `source_r2_key` set)    | `original.json` written |
| Published                 | `books` + `chapters` rows updated to `published` | No change to R2         |

---

## 9. Translation Lifecycle

Translations have a more complex lifecycle because they involve AI generation, human review, and a multi-chapter batch workflow managed through **ingestion sessions**.

### Step 1: Create a Translation record

```
POST /api/admin/books/:bookSlug/translations
Body: { title, slug?, description?, model, prompt, contextBeforeChapterCount?, contextAfterChapterCount? }
```

1. A `translations` row is created in D1 with `status = 'draft'`.
2. An `admin_ingestion_sessions` row is created, linked to this translation via `translation_id`.
3. For each chapter of the source book, an `admin_ingestion_chapters` row is created with:
   - `source_text`: the reconstructed text from the existing `original.json` in R2.
   - `source_chapter_slug`: pointing back to the original chapter.
   - `status = 'pending'`.

### Step 2: Generate a chapter (AI call)

```
POST /api/admin/ingestion/sessions/:sessionId/chapters/:position/generate
```

For each chapter, the admin (or a batch process) triggers generation:

1. The system retrieves neighboring chapters (controlled by `context_before_chapter_count` and `context_after_chapter_count`) for LLM context.
2. A prompt is built combining:
   - The **session's system prompt** (stored in `admin_ingestion_sessions.prompt`).
   - The **current chapter's source text** (from `admin_ingestion_chapters.source_text`).
   - **Context from neighboring chapters** (previous/next chapters' generated content if available, or source text).
3. An API call is made to **OpenRouter** (via `callOpenRouterChat()`).
4. The LLM returns a JSON payload with this shape:

```jsonc
{
  "chapterTitle": "Book 1: The Rage",
  "notes": "...", // AI-generated notes
  "originalChunks": [
    { "text": "...", "type": "verse" }, // re-chunked original text
  ],
  "translationChunks": [
    {
      "text": "...", // translated text
      "type": "verse",
      "sourceOrdinals": [1, 2], // 1-indexed references to originalChunks
    },
  ],
}
```

5. The response is parsed and normalized via `normalizeGeneratedChapter()`:
   - Original chunks get IDs `c1`, `c2`, ...
   - Translation chunks get IDs `t1`, `t2`, ...
   - `sourceOrdinals` are converted to `sourceChunkIds` (e.g., `[1, 2]` → `["c1", "c2"]`).
6. The `admin_ingestion_chapters` row is updated:
   - `status` → `'generated'`
   - `raw_response` ← raw LLM text
   - `original_document_json` ← serialized `OriginalChapterDocument`
   - `translation_document_json` ← serialized `TranslationChapterDocument`
   - `notes` ← AI notes

**At this point, nothing is written to R2 yet.** The generated content lives only in D1 as JSON strings.

### Step 3: Save a chapter (commit to R2)

```
PUT /api/admin/ingestion/sessions/:sessionId/chapters/:position/save
```

When the admin approves a generated chapter:

1. The `admin_ingestion_chapters` row's `status` is updated to `'saved'`.
2. If this is a **translation session** (i.e., `session.translation_id` is set):
   - The `TranslationChapterDocument` JSON is written to R2 at `epics/{bookSlug}/{chapterSlug}/translations/{translationSlug}.json`.
   - The `translations` row's `status` is updated to `'ready'` and `ai_system_prompt` is saved.
3. The session's `current_chapter_index` is advanced.

### Step 4: Validate the translation

```
GET /api/admin/translations/:translationId/validate
```

Before publishing, the admin can validate the entire translation:

- Checks all chapters have been generated/saved.
- Validates `sourceChunkIds` references are valid.
- Reports warnings/errors per chapter.

### Step 5: Publish

The admin sets `status = 'published'` on the translation. Published translations appear in the reader's translation picker.

### Where data lives at each stage:

| Stage               | D1 changes                                                                                              | R2 changes                     |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Translation created | `translations` row (draft) + `admin_ingestion_sessions` row + `admin_ingestion_chapters` rows (pending) | —                              |
| Chapter generated   | `admin_ingestion_chapters` updated: status→generated, raw_response, original/translation JSON           | —                              |
| Chapter saved       | `admin_ingestion_chapters` status→saved, `translations` status→ready                                    | Translation JSON written to R2 |
| Published           | `translations` status→published                                                                         | No change                      |

### Session Modes

An ingestion session supports two source modes:

| Mode               | `source_mode`    | Behavior                                                                           |
| ------------------ | ---------------- | ---------------------------------------------------------------------------------- |
| **Paste**          | `paste`          | Admin pastes raw text directly; chapters are created from the pasted content       |
| **Existing Story** | `existing_story` | Chapters are derived from an existing book's R2 content; `source_book_slug` is set |

The `existing_story` mode is the primary path for translations — it reads the existing original text from R2 and populates ingestion chapters from it.

---

## 10. Status State Machines

### Book / Chapter Status

```
draft ──► published
```

Simple two-state lifecycle. Only `published` books/chapters appear on the public reader.

### Translation Status

```
draft ──► generating ──► ready ──► published
  │           │
  │           ▼
  │        failed
  │           │
  └───────────┘  (can retry)
```

| Status       | Meaning                                                   |
| ------------ | --------------------------------------------------------- |
| `draft`      | Translation record exists but no generation has been done |
| `generating` | AI generation is in progress                              |
| `ready`      | All chapters generated and saved to R2; awaiting publish  |
| `published`  | Visible to readers                                        |
| `failed`     | Generation encountered an error; retryable                |

### Ingestion Chapter Status

```
pending ──► generated ──► saved
              │
              ▼
            error ──► (retry: back to pending/generated)
```

| Status      | Meaning                                                     |
| ----------- | ----------------------------------------------------------- |
| `pending`   | Waiting to be processed                                     |
| `generated` | LLM response received and parsed; content stored in D1 only |
| `saved`     | Content committed to R2                                     |
| `error`     | LLM call or parsing failed; can be retried                  |

---

## 11. Key Helper Functions

Located in `apps/api/src/index.ts`:

| Function                                 | Purpose                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `buildInitialOriginalDocument()`         | Auto-chunks raw text into an `OriginalChapterDocument` using verse/prose heuristics                  |
| `generateChapterWithOpenRouter()`        | Sends a chapter to OpenRouter for translation, with context from neighboring chapters                |
| `normalizeGeneratedChapter()`            | Parses the raw LLM response into structured `OriginalChapterDocument` + `TranslationChapterDocument` |
| `persistGeneratedChapter()`              | Saves parsed AI output to D1 (and optionally to R2 when `statusOnSuccess = 'saved'`)                 |
| `validateTranslation()`                  | Validates all chapters of a translation; checks sourceChunkIds integrity                             |
| `readObjectJson()` / `writeObjectJson()` | Generic R2 read/write helpers                                                                        |
| `getSettingsMap()`                       | Reads all `app_settings` into a dictionary                                                           |
| `buildGenerationUserPrompt()`            | Constructs the user prompt including source text and context chapters                                |
| `parseAiChapterPayload()`                | Extracts and validates the JSON structure from a raw LLM response                                    |
| `slugify()`                              | Converts a string to a URL-safe slug                                                                 |

---

## 12. Export / Import Archives

The system defines portable JSON archive formats for moving content between environments (e.g., local → production).

### `BookExportArchive`

```typescript
interface BookExportArchive {
  version: 1;
  exportedAt: string;
  book: Omit<BookSummary, "status"> & { originalLanguage: string | null };
  chapters: Array<{
    meta: Omit<ChapterSummary, "status">;
    chunks: TextChunk[];
  }>;
}
```

Contains the book metadata, all chapters, and all original chunks from R2. Imported books always start as `draft`.

### `TranslationExportArchive`

```typescript
interface TranslationExportArchive {
  version: 1;
  exportedAt: string;
  bookSlug: string;
  translation: Omit<TranslationSummary, "status"> & {
    aiSystemPrompt: string | null;
  };
  chapters: Record<string, TranslationChapterDocument>; // keyed by chapterSlug
}
```

Contains the translation metadata and all per-chapter translation documents from R2.

> **Note:** Export/import API endpoints are defined in the plan but are not yet fully implemented in the current codebase.

---

## Quick Reference: File Locations

| What                             | Where                                  |
| -------------------------------- | -------------------------------------- |
| D1 schema / migrations           | `apps/api/migrations/0001_initial.sql` |
| Shared TypeScript types          | `packages/shared/src/types.ts`         |
| R2 key builders                  | `packages/shared/src/r2.ts`            |
| API routes + all business logic  | `apps/api/src/index.ts`                |
| Wrangler config (D1/R2 bindings) | `apps/api/wrangler.jsonc`              |
| Seed SQL data                    | `apps/api/seed/seed.sql`               |
| Seed R2 data                     | `apps/api/seed/r2/epics/...`           |
| Seed script                      | `apps/api/scripts/seed-local.mjs`      |
| Frontend app                     | `apps/web/src/App.tsx`                 |
