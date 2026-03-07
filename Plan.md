# Ancient Epics Implementation Plan

## Objective

Build the first production-ready version of Ancient Epics as a subscription reading app with:

- a public library and side-by-side reading experience
- multiple pre-generated translation variants per book
- account creation, gated access, and Stripe-backed subscriptions
- note-taking and contextual AI assistance
- an admin workflow for ingesting, translating, previewing, and publishing content

This plan assumes the architecture described in [README.md](/Users/adityapk/gittea/ancient_epics/README.md): React + Vite + TypeScript on Cloudflare Pages, Cloudflare Workers for APIs, D1 for relational data, and R2 for static text assets.

## Delivery Strategy

Ship the admin content pipeline first. This ensures high-quality data generation and allows testing the chunking and AI workflows independently. Once the ingestion, translation, review, and publishing workflows are robust, we build the user-facing Reader MVP to consume the published texts, followed by monetization.

### Phase 0: Architecture and Project Setup (Completed)

Goal: establish the repo structure, deployment pipeline, and shared contracts.

### Phase 1: Database Schema & Core Setup (Completed)

Goal: Establish the data models to support draft/published states and application settings.

Deliverables:

- Refine D1 schema: Books, Chapters, and Translations require a `status` field (`draft` or `published`), retiring the simple `is_published` boolean.
- Create an `app_settings` table (or KV) to securely store the OpenRouter API key and preferred default AI models.
- Define the canonical JSON layouts for imports and exports independently:
  - Original Text Export: includes book metadata, chapter metadata, and ordered original chunks.
  - Translation Export: includes translation metadata and ordered translation chunks with `sourceChunkIds` anchors back to the original.
- Notes should anchor against a document reference, not an assumed globally shared chunk ID.

### Phase 2: Admin Text Upload & Chunking Editor

Goal: Allow admins to upload raw texts, automatically chunk them, and visually edit the source text boundaries that translations will later reference.

Deliverables:

- Admin UI to create a Book (e.g., _Epic of Gilgamesh_) and Chapter.
- Upload raw text file or paste massive text block.
- **Smart Chunking Logic**:
  - _Verse_: Split by newline (1 chunk = 1 line).
  - _Prose / Plays_: Split by paragraph (`\n\n`) or by continuous dialogue block (detect speaker names/indentation).
- **Chunk Editor UI**:
  - Preview the generated chunks in a list view.
  - Tools to manually edit the text of a chunk, split one chunk into two, or merge two adjacent chunks.
  - Ensure every chunk receives a permanent, stable ID.
- Save finalized original text chunks to R2 (as `draft`).

### Phase 3: Admin Translation Segmentation & AI Engine

Goal: Let each translation define its own passage boundaries, then translate and refine against those boundaries.

Deliverables:

- Admin Settings UI to configure the OpenRouter API Key and select the target model (e.g., `gpt-4o`, `anthropic/claude-3.5-sonnet`).
- UI to define a Translation variant (e.g., "Verse - Preserved Meter") and configure the base system prompt.
- **Translation Segmentation UI**:
  - Auto-generate a first pass of translation chunks from the original chunk list.
  - Allow each translation variant to merge or split source chunks independently.
  - Persist an ordered list of translation chunks where each chunk has its own stable ID and `sourceChunkIds` array.
- **Batch Translation Kicker**:
  - Allow the admin to select a target translation type and physically add custom instructions to the prompt before initiating.
  - Worker process to automatically iterate over translation chunks, not raw original chunks.
  - Make a series of OpenRouter calls using the source span for the current translation chunk plus neighboring translation chunks for context.
  - Save received translations back to R2 incrementally.
- **Manual Review & Refine UI**:
  - Side-by-side view of the source span vs. the translation passage.
  - Inline editing of translation text and translation segment boundaries.
  - _Fine-tune with AI_: A specific "modify" button on a translation chunk that allows the admin to enter a custom prompt (e.g., "Make this sound more angry") and regenerates just that translation chunk via OpenRouter.

### Phase 4: Admin Preview, Export/Import, & Publishing

Goal: Finalize the ingestion workflow, allowing content portability and release management.

Deliverables:

- **Draft Preview**: Render the side-by-side reading layout within the Admin dashboard using the exact components the public Reader will use, validating that translation-owned passage groupings and source anchors read well together.
- **Export & Import Workflows**:
  - Independent _Export_ buttons on the Admin Book and Admin Translation screens. Generates a downloaded `.json` containing DB metadata and R2 chunks.
  - _Import_ screen to upload these archives into a new environment (e.g., generated locally, exported, then imported to production).
  - Imported texts always start their lifecycle in `draft` mode.
- **Publishing**: Toggle button to transition a Book/Chapter or Translation from `draft` to `published`.

### Phase 5: Reader MVP (Public Library)

Goal: Deliver the core reading experience for end-users using the published content.

Deliverables:

- Home page library showing ONLY `published` books.
- Reader page using a source-anchored side-by-side layout that does not require one-to-one chunk parity.
- Translation picker (only showing `published` translations).
- Responsive mobile layout (stacking the source span above the translation passage).

### Phase 6: User Accounts, Billing, & Premium Access

Goal: Enforce account boundaries and Stripe subscriptions before marketing the platform.

Deliverables:

- Sign up, log in, and session management.
- Stripe checkout flow and webhook handling.
- D1 subscription state synchronized from Stripe events.
- Gated access: Check user tier before fetching premium chunks from R2.

### Phase 7: Notes and "Ask AI"

Goal: Add interactive features on top of reading.

Deliverables:

- Text selection menu over chunks.
- Save Note flow anchored to an original or translation passage reference.
- Ask AI for contextual vocabulary/thematic meaning via Cloudflare Workers AI.

## Recommended MVP Scope

The smallest convincing release is Phases 1 through 5.

- A fully functional Admin suite to generate, edit, refine, and publish texts reliably.
- A public library that renders these texts beautifully.
- Defer Stripe, billing, user accounts, and notes until the content generation pipeline is proven and a sufficient library is built.

## Proposed API Surface

**Admin Endpoints (Phases 1-4)**

- `GET /api/admin/books`, `POST /api/admin/books`
- `POST /api/admin/books/:id/upload-and-chunk`
- `PUT /api/admin/chapters/:id/chunks` (Save manual chunk edits)
- `PUT /api/admin/translations/:id/chunks` (Save translation segment edits and source anchors)
- `POST /api/admin/translations/:id/generate` (Kick off batch OpenRouter translation)
- `POST /api/admin/translations/chunks/:chunkId/refine` (Custom AI prompt refinement)
- `PUT /api/admin/translations/chunks/:chunkId` (Manual translation text edit)
- `GET /api/admin/export/books/:id`, `POST /api/admin/import/books`
- `GET /api/admin/export/translations/:id`, `POST /api/admin/import/translations`
- `POST /api/admin/books/:id/publish`, `POST /api/admin/translations/:id/publish`
- `GET /api/admin/settings`, `PUT /api/admin/settings` (OpenRouter API Key & Models)

**Reader Endpoints (Phase 5+)**

- `GET /api/books` (Only returns `status='published'`)
- `GET /api/books/:bookSlug/chapters/:chapterSlug`
- `GET /api/books/:bookSlug/chapters/:chapterSlug/translations/:translationSlug`
- User auth, Stripe, and Note endpoints (Deferred to Phases 6-7).

## Data Model Adjustments Recommended Before Build

- **`books`, `chapters`, `translations`**: replace `is_published` with `status TEXT DEFAULT 'draft'`.
- **`app_settings`** table:
  ```sql
  CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
  );
  -- e.g., key='openrouter_api_key', value='sk-or-v1-...'
  -- e.g., key='default_translation_model', value='openai/gpt-4o'
  ```
- **Translation chapter documents** should be arrays of translation-owned chunks, each with its own stable ID, text, ordinal, and `sourceChunkIds`.
- **Notes** should store `anchor_document`, `anchor_id`, and optional `translation_id` instead of assuming one universal `chunk_id` namespace.
- Make sure chunking logic heuristics account for missing speaker metadata in classic plays.

## Suggested Build Order

1. Finalize D1 schema with `status` and `app_settings`.
2. Build Admin API and UI for Settings (OpenRouter Key entry).
3. Build Admin Text Upload, auto-chunking heuristics, and the original chunk editor UI.
4. Build translation segmentation tooling so every translation can define its own passage boundaries.
5. Integrate OpenRouter API logic for batch translation and individual translation-chunk refinement.
6. Build the Admin Manual Review & Refine UI for translations.
7. Build the Draft Preview UI to visually verify the text and translations as a reader would see them.
8. Add Export/Import and Publishing toggles.
9. Build the public Reader MVP using only 'published' data.
10. Integrate Auth and Stripe for monetization.
11. Add User features (Notes, Ask AI).

## Definition of Done for v1

Version 1 should be considered complete when:

- An admin can upload a raw text (e.g. Gilgamesh), have it accurately chunked, and visually edit the boundaries.
- Each translation variant can define its own passage grouping over the source chunks.
- The admin can auto-translate the text using OpenRouter and manually fine-tune specific translation chunks via AI "modify" prompts.
- The entire corpus can be exported from local dev and imported to production correctly as drafts.
- Drafts can be previewed organically and flipped to published.
- Users can browse and read published side-by-side texts flawlessly.
