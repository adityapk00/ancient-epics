# Data Model Reference

This document describes the current Ancient Epics data model as implemented in this repo.

## Overview

- D1 stores relational metadata and workflow state.
- R2 stores chapter payload JSON.
- `original.json` stores chapter metadata plus canonical `fullText`.
- Each translation chapter JSON owns its own chunking and stores paired source/translation text.

## Core Entities

### Book

A book is the top-level work. D1 stores:

- `slug`
- `title`
- `author`
- `original_language`
- `description`
- `status`

### Chapter

A chapter is one section of a book. D1 stores:

- `slug`
- `position`
- `title`
- `is_preview`
- `source_r2_key`
- `status`

The actual chapter text is not stored in D1.

### Translation

A translation is a named rendering strategy for a book. D1 stores:

- `slug`
- `name`
- `description`
- `ai_system_prompt`
- `output_r2_prefix`
- `status`

Translated text is not stored in D1.

### Notes

Notes are translation-specific.

- `translation_id` is required
- `anchor_id` points to a translation chunk id

## Storage Layout

### D1

D1 stores:

- books
- chapters
- translations
- users
- notes
- app settings
- admin ingestion sessions
- admin ingestion chapters

### R2

R2 stores:

- original chapter documents at `epics/{bookSlug}/{chapterSlug}/original.json`
- translation chapter documents at `epics/{bookSlug}/{chapterSlug}/translations/{translationSlug}.json`

## R2 Schemas

### `OriginalChapterDocument`

```json
{
  "bookSlug": "iliad",
  "chapterSlug": "book-1-the-rage",
  "fullText": "Full chapter source text..."
}
```

Notes:

- `fullText` is the canonical source text for the chapter.
- `original.json` does not define canonical chunks.

### `TranslationChapterDocument`

```json
{
  "translationSlug": "verse-meaning",
  "chunks": [
    {
      "id": "t1",
      "ordinal": 1,
      "type": "verse",
      "originalText": "Source passage text...",
      "translatedText": "Rendered translation text..."
    }
  ]
}
```

Notes:

- Chunking is translation-owned.
- Different translations may split the same chapter differently.
- Each chunk carries both the source passage and the translation passage.
- Chunk ids are translation-local and are used for note anchors.

## Shared TypeScript Shapes

Implemented in [types.ts](/Users/adityapk/gittea/ancient_epics/packages/shared/src/types.ts).

Important types:

- `OriginalChapterDocument`
- `TranslationChapterDocument`
- `TranslationChunk`
- `AdminIngestionChapterRecord`
- `ChapterPayload`
- `TranslationPayload`

## Ingestion and Translation Flow

### Book creation

When a book is created:

1. D1 book and chapter rows are inserted.
2. Each chapter gets an `original.json` document with `fullText`.

### Translation generation

The generation prompt now asks the model to return:

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

Normalization rules:

- the app assigns `id` and `ordinal`
- `originalText` and `translatedText` are trimmed
- each chunk must contain non-empty source and translated text

### Validation

Validation checks:

- `original.fullText` exists
- the translation has at least one chunk
- each chunk has non-empty `originalText`
- each chunk has non-empty `translatedText`
- concatenating all chunk `originalText` values reconstructs the chapter `fullText`

This catches dropped, duplicated, or reordered source text during chunk editing.

## Admin UI Model

The admin translation workspace edits a single paired chunk list:

- one row per translation chunk
- left side edits `originalText`
- right side edits `translatedText`
- one `type` per row

The raw JSON editor uses the same schema as the backend generation payload:

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
- Cross-translation alignment is no longer based on source chunk ids.
- Original passage boundaries are defined per translation.
- Notes are stable only within a specific translation, not across all translations.
