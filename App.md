## Product Overview: Ancient Epics

**Mission:** Make ancient and culturally significant texts such as the _Epic of Gilgamesh_, the _Iliad_, and Shakespeare accessible through customizable AI-generated translations and a reader that supports different interpretive styles.

**Target Audience:** Students, history enthusiasts, casual readers, and academics who want better access to difficult texts without flattening them into a single translation style.

**Monetization:** SaaS subscription model with free, trial, and paid tiers managed through Stripe.

## Technical Stack

| Component          | Technology Choice                     | Purpose                                              |
| ------------------ | ------------------------------------- | ---------------------------------------------------- |
| Frontend Framework | React + Vite + TypeScript             | Fast iteration and strict shared contracts           |
| Styling            | Tailwind CSS                          | Responsive reading views and admin tooling           |
| Hosting & CDN      | Cloudflare Pages                      | Low-latency static frontend delivery                 |
| Backend API        | Cloudflare Workers                    | Auth, billing, content routing, and admin APIs       |
| Database           | Cloudflare D1                         | User data, subscriptions, metadata, and note anchors |
| Storage            | Cloudflare R2                         | Immutable source and translation JSON documents      |
| AI Integration     | Cloudflare Workers AI / external LLMs | Translation generation and contextual explanations   |

## Phase 0 Setup

The repository includes a working pnpm monorepo foundation for the initial deliverables.

### Workspace Layout

```text
apps/
  api/        Cloudflare Worker API, D1 migrations, local seed tooling
  web/        React + Vite + Tailwind frontend
packages/
  shared/     Shared types and R2 key builders
```

### Local Development

1. Install dependencies.

   ```bash
   pnpm install
   ```

2. Seed local D1 and R2 state.

   ```bash
   pnpm seed:local
   ```

3. Start the frontend and Worker together.

   ```bash
   pnpm dev
   ```

The Vite app runs on `http://127.0.0.1:5173` and proxies `/api` requests to the Worker on `http://127.0.0.1:8787`.

### Environment Files

- Copy `apps/web/.env.example` to `apps/web/.env` if you want to override the API origin.
- Copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars` and fill in local secrets for Stripe and session configuration.
- Update `apps/api/wrangler.jsonc` with real D1 database IDs and R2 bucket names before deploying.

### Included Sample Data

- Seeded metadata for one published sample book (`iliad`)
- One published chapter with a canonical `original.json`
- One published translation whose passage boundaries intentionally differ from the source chunk boundaries

### Shared R2 Naming Convention

- Originals: `epics/:bookSlug/:chapterSlug/original.json`
- Translations: `epics/:bookSlug/:chapterSlug/translations/:translationSlug.json`

## Core UI & Rendering Strategy

The defining feature of the app is still the side-by-side reading experience, but the reader no longer assumes a one-to-one chunk mapping between original and translation. Instead it uses a **Source-Anchored Dual-Passage Layout**.

- **Original Data Structure:** The source text is chunked according to the structure of the original work, such as verse lines, paragraphs, or dialogue blocks.
- **Translation Data Structure:** Every translation stores its own ordered chunk list. A translation may be line-by-line, stanza-by-stanza, or a more interpretive grouped rendering.
- **Anchoring:** Each translation chunk carries `sourceChunkIds`, the ordered list of source chunks it covers.
- **Rendering Model:** The reader resolves those source anchors at render time and displays the source span next to the translation passage. This preserves context without forcing every translation to mirror the source chunk count.
- **Mobile Responsiveness:** On narrow screens, the source span stacks above the translation passage for each rendered unit.

## Key Features & User Flows

### 1. Library & Reading Experience

- **Home Dashboard:** A visually appealing, scrollable library of available epics.
- **Translation Selection:** When a reader opens a book, they can choose among published translation styles such as literal, modern prose, or atmosphere-first interpretations.
- **Contextual Tooling:** When a user highlights a passage, a lightweight context menu can open actions for notes and AI explanation.
- **Save Note:** Opens a modal to save a private note anchored to the selected original or translation passage.
- **Ask AI:** Sends the selected passage to an LLM for explanation of context, vocabulary, or theme.

### 2. User Accounts & Monetization

- **Authentication:** Users can browse the landing page and possibly read a sample chapter, but must sign up to unlock premium text and notes.
- **Subscription Management:** A settings page shows the user tier and Stripe-backed billing state.
- **Access Control:** The Worker checks subscription state before returning premium chapter assets from R2.

### 3. Admin Capabilities

- **Source Content Management:** Upload and edit original texts.
- **Translation Variant Management:** Create translation styles with their own chunking plans and prompts.
- **Preview & Publish:** Review the final source-anchor layout before publishing.

---

# Data Architecture & Storage Design

This document covers storage separation, schemas, R2 document layouts, and the admin workflow for creating translations with independent chunking.

## 1. Storage Split: Cloudflare D1 vs. R2

### Cloudflare D1

D1 stores dynamic, queryable data.

- User accounts, auth state, and subscriptions
- App metadata for books, chapters, and translation variants
- Notes and passage anchors
- Admin settings and translation job state

### Cloudflare R2

R2 stores immutable content payloads.

- Source chapter JSON
- Translation chapter JSON
- Static assets such as covers and portraits

## 2. Table Schemas (Cloudflare D1)

```sql
CREATE TABLE books (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    original_language TEXT,
    description TEXT,
    cover_image_url TEXT,
    status TEXT NOT NULL DEFAULT 'draft'
);

CREATE TABLE chapters (
    id TEXT PRIMARY KEY,
    book_id TEXT REFERENCES books(id),
    slug TEXT NOT NULL,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    source_r2_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft'
);

CREATE TABLE translations (
    id TEXT PRIMARY KEY,
    book_id TEXT REFERENCES books(id),
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    ai_system_prompt TEXT,
    output_r2_prefix TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft'
);

CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    book_id TEXT REFERENCES books(id),
    chapter_id TEXT REFERENCES chapters(id),
    translation_id TEXT REFERENCES translations(id),
    anchor_document TEXT NOT NULL,
    anchor_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 3. Storage File Layout (Cloudflare R2)

The frontend fetches content per chapter. Source text and each translation variant are stored separately.

```text
/epics
  /iliad
    /book-1-the-rage
      original.json
      /translations
        verse-meaning.json
        prose-modern.json
```

### Source chapter document

```json
{
  "bookSlug": "iliad",
  "chapterSlug": "book-1-the-rage",
  "chunks": [
    {
      "id": "c1",
      "type": "verse",
      "text": "Mῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος",
      "ordinal": 1
    },
    {
      "id": "c2",
      "type": "verse",
      "text": "οὐλομένην, ἣ μυρί᾽ Ἀχαιοῖς ἄλγε᾽ ἔθηκε,",
      "ordinal": 2
    },
    {
      "id": "c3",
      "type": "verse",
      "text": "πολλὰς δ᾽ ἰφθίμους ψυχὰς Ἄϊδι προΐαψεν",
      "ordinal": 3
    }
  ]
}
```

### Translation chapter document

```json
{
  "translationSlug": "verse-meaning",
  "chunks": [
    {
      "id": "t1",
      "type": "verse",
      "text": "Sing, goddess, the wrath of Achilles, Peleus' son, and the ruin it brought down in wave after wave upon the Achaeans.",
      "ordinal": 1,
      "sourceChunkIds": ["c1", "c2"]
    },
    {
      "id": "t2",
      "type": "verse",
      "text": "It drove so many valiant souls ahead to the house of Hades.",
      "ordinal": 2,
      "sourceChunkIds": ["c3"]
    }
  ]
}
```

### Why this works in the reader

When a reader switches translations, the frontend fetches a different translation document and resolves each translation chunk against the source chunks listed in `sourceChunkIds`. That supports both literal and interpretive translations without requiring identical chunk boundaries.

## 4. Admin Workflow

### Step 1: Upload and chunk the original text

1. The admin creates a book and chapter record.
2. They upload raw source text.
3. The backend chunks the source text using heuristics that fit the text form.
4. The system assigns stable source chunk IDs and saves `original.json` to R2.

### Step 2: Define a translation variant and segment plan

1. The admin creates a translation type.
2. They define the translation prompt and the segmentation approach.
3. The admin can merge or split source chunks into translation-specific passages.
4. The system stores translation chunks with stable translation IDs and `sourceChunkIds` anchors.

### Step 3: Generate the translation

1. The admin starts generation.
2. A Worker loops through translation chunks, not raw source chunks.
3. For each translation chunk, the Worker sends the full source span plus neighboring spans for context.
4. The LLM returns one translation passage for that chunk.
5. The Worker writes the result back into the translation JSON document in R2.

### Step 4: Review and publish

1. The admin previews the source-anchored reading layout.
2. They manually edit any translation chunk text or source anchors that need correction.
3. Once approved, they flip the database records to `published`.
