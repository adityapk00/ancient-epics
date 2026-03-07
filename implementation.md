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

Ship in phases so the team can validate the core reading experience before building billing and admin complexity.

### Phase 0: Architecture and Project Setup

Goal: establish the repo structure, deployment pipeline, and shared contracts.

Deliverables:

- Initialize a Vite React + TypeScript frontend.
- Initialize a Cloudflare Worker API project with local development support.
- Add Tailwind CSS and a shared design token layer.
- Define shared TypeScript types for books, chapters, chunks, translations, users, notes, and API responses.
- Add environment configuration for D1, R2, Workers AI, and Stripe.
- Set up CI for typecheck, lint, and build.

Key tasks:

- frontend and worker live in a monorepo using pnpm workspaces.
- Create a D1 migration strategy from day one.
- Create a local seed process with one sample book and one translation.
- Define R2 key naming conventions and shared path builders.

Acceptance criteria:

- Local development can run frontend and Worker together.
- D1 migrations apply successfully in local and remote environments.
- A sample book can be fetched from local APIs using seeded metadata and sample R2 content.

### Phase 1: Content Model and Ingestion Pipeline

Goal: make book content representable, chunked, stored, and retrievable.

Deliverables:

- Final D1 schema for books, chapters, translations, users, notes, and admin metadata.
- R2 file layout for original chapter content and translation variants.
- A chunking pipeline that transforms uploaded raw text into aligned JSON chapter files.
- Validation tooling to detect missing chunk IDs, duplicate chunk IDs, and translation coverage gaps.

Key tasks:

- Extend the current schema with operational fields likely needed in production:
  - `created_at`, `updated_at`
  - `published_at`
  - translation generation status
  - chapter-level source file metadata
- Define canonical JSON schemas:
  - `original.json` with ordered chunk arrays
  - translation JSON with chunk-ID keyed dictionaries
- Implement chunking modes:
  - verse mode split by line
  - prose mode split by paragraph
  - optional manual override markers for difficult texts
- Build an ingestion command or Worker endpoint that:
  - creates chapter metadata
  - assigns stable chunk IDs
  - uploads chapter JSON into R2

Acceptance criteria:

- At least one full sample text can be ingested into R2 from raw source material.
- Every original chunk has a stable ID and deterministic ordering.
- Validation reports fail when translations do not match the original chunk set.

### Phase 2: Reader MVP

Goal: deliver the core value of the product: a fast, legible, aligned reading interface.

Deliverables:

- Library or home page listing available books.
- Book detail page with chapter navigation.
- Reader page using the single-scrollbar chunk-row layout.
- Translation picker that swaps translation JSON without breaking alignment.
- Responsive mobile layout that stacks original and translation blocks.

Key tasks:

- Design frontend routes:
  - `/`
  - `/books/:bookSlug`
  - `/books/:bookSlug/:chapterSlug`
- Fetch original chapter content and one translation in parallel.
- Render by iterating the original chunk list and looking up translation text by chunk ID.
- Handle missing translation chunks gracefully with placeholders and observability.
- Add loading, empty, and error states.
- Add typography presets appropriate for verse and prose.

Acceptance criteria:

- Users can browse the catalog and open a chapter.
- Users can switch translation variants without a full page reload.
- Row alignment remains correct across long and short chunk pairs.
- Reader performance remains acceptable on a chapter-sized dataset.

### Phase 3: Authentication and Access Control

Goal: enforce account boundaries and prepare the app for monetization.

Deliverables:

- Sign up, log in, and session management.
- Public preview access for free sample content.
- Protected access for full content.
- User profile persistence in D1.

Key tasks:

- Choose auth implementation compatible with Cloudflare Workers.
- Create middleware for user session resolution.
- Mark books or chapters as previewable versus premium.
- Add API authorization checks before premium chapter fetches.

Acceptance criteria:

- Anonymous users can browse landing and preview content only.
- Authenticated users can access entitlements appropriate to their tier.
- Unauthorized content requests are rejected at the Worker layer.

### Phase 4: Stripe Billing and Subscription States

Goal: connect payments to access control without blocking the reader experience.

Deliverables:

- Stripe checkout flow.
- Webhook handling for subscription lifecycle changes.
- Settings page displaying current tier and billing status.
- D1 subscription state synchronized from Stripe events.

Key tasks:

- Define source of truth for entitlements: Stripe event state persisted into D1.
- Support at minimum these statuses:
  - `free`
  - `trial`
  - `active`
  - `expired`
- Create webhook idempotency handling.
- Expose an entitlement API consumed by the frontend.

Acceptance criteria:

- Successful checkout upgrades the user’s entitlement.
- Subscription cancellation or payment failure eventually downgrades access.
- Settings page reflects actual persisted subscription state.

### Phase 5: Notes and Ask AI

Goal: add the first interactive features on top of reading.

Deliverables:

- Text selection menu in the reader.
- Save Note flow anchored to `book_id`, `chapter_id`, and `chunk_id`.
- Ask AI flow that sends selected text plus local context to Workers AI.
- Notes retrieval and rendering when revisiting a chapter.

Key tasks:

- Decide whether note anchors support one chunk, multi-chunk ranges, or arbitrary text spans.
- Start with chunk-level anchors for reliability.
- Send bounded context to Workers AI:
  - selected chunk text
  - neighboring chunks
  - metadata about book, chapter, and translation
- Add rate limiting and usage logging for AI requests.

Acceptance criteria:

- Users can save and retrieve private notes tied to a specific chunk.
- Ask AI returns contextual explanations without exposing unrelated content.
- The reader UI remains usable on desktop and mobile when selection tooling is active.

### Phase 6: Admin Content Management

Goal: make content operations manageable without manual R2 editing.

Deliverables:

- Admin-only dashboard and route protection.
- Book creation and chapter upload workflow.
- Translation-type management with system prompts and publishing controls.
- Translation generation jobs and preview before publish.

Key tasks:

- Create admin roles or allowlist-based access.
- Add forms for:
  - book metadata
  - chapter metadata
  - translation definitions
  - upload of raw source files
- Build translation generation workflow:
  - load original chunks
  - send sliding-window context to LLM
  - write translated chunk dictionary keyed by original IDs
  - validate coverage and preview result
- Add publish toggles for books and translations.

Acceptance criteria:

- An admin can ingest a new chapter without touching the database manually.
- An admin can generate a translation variant and preview it before publication.
- The publish process prevents incomplete or invalid translation files from going live.

### Phase 7: Quality, Observability, and Launch Hardening

Goal: reduce operational risk before public release.

Deliverables:

- Logging and error reporting across frontend and Worker.
- Analytics for reader engagement and conversion funnel.
- Content validation checks in CI or admin publish flow.
- Performance and caching review for R2-backed chapter delivery.

Key tasks:

- Add structured logs for content fetches, auth failures, Stripe webhooks, and AI calls.
- Cache immutable chapter assets aggressively.
- Test cold-start and edge performance for chapter reads.
- Add smoke tests for:
  - opening a book
  - switching translation
  - saving a note
  - entitlement checks
  - webhook processing

Acceptance criteria:

- Critical user journeys have automated coverage.
- Published chapter assets are cacheable and fast to retrieve.
- Operational failures are visible through logs and alerts.

## Recommended MVP Scope

The smallest convincing release is Phases 0 through 4, plus a narrow slice of Phase 5.

Include in MVP:

- library page
- reader with translation switching
- one or two books with multiple translation styles
- account creation and login
- Stripe subscription gating
- basic chunk-level notes

Defer until after MVP if needed:

- full admin dashboard polish
- inline manual editing of translation JSON
- advanced note anchoring across arbitrary ranges
- rich analytics and recommendation features

## Proposed API Surface

Initial Worker endpoints should likely include:

- `GET /api/books`
- `GET /api/books/:bookSlug`
- `GET /api/books/:bookSlug/chapters/:chapterSlug`
- `GET /api/books/:bookSlug/chapters/:chapterSlug/translations/:translationSlug`
- `GET /api/me`
- `GET /api/me/subscription`
- `GET /api/me/notes?book=:id&chapter=:id`
- `POST /api/notes`
- `POST /api/ai/explain`
- `POST /api/stripe/create-checkout-session`
- `POST /api/stripe/webhook`
- `POST /api/admin/books`
- `POST /api/admin/chapters/upload`
- `POST /api/admin/translations`
- `POST /api/admin/translations/:id/generate`
- `POST /api/admin/translations/:id/publish`

## Data Model Adjustments Recommended Before Build

The README schema is a strong base, but implementation will be smoother with a few additions.

Recommended D1 additions:

- `chapters.source_r2_key` to track canonical original content file
- `translations.output_r2_prefix` or chapter-level output conventions
- `translations.status` for draft, generating, ready, published, failed
- `users.role` if admin capability will be role-based
- `notes.updated_at` for editing support
- `translation_jobs` table if generation is asynchronous and auditable

Potential new table:

```sql
CREATE TABLE translation_jobs (
    id TEXT PRIMARY KEY,
    translation_id TEXT NOT NULL REFERENCES translations(id),
    chapter_id TEXT NOT NULL REFERENCES chapters(id),
    status TEXT NOT NULL,          -- queued, running, failed, completed
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT
);
```

## Dependencies and Sequencing Risks

Critical dependencies:

- The chunking contract must be stable before translation generation begins.
- Auth and entitlement logic must be finalized before premium gating is shipped.
- Stripe webhook handling must be idempotent before production billing is enabled.

Main risks:

- inconsistent chunking between original and translated content
- UI regressions on very long chapter pages
- LLM translation drift or hallucinations during bulk generation
- operational complexity if admin tooling is delayed and content must be managed manually

Mitigations:

- treat original chunk IDs as immutable once published
- validate every translation file against the original chunk inventory
- start with a small curated content set before scaling ingestion
- build preview and publish gates into admin workflows

## Suggested Build Order

1. Set up the project foundation, shared types, and local Cloudflare development.
2. Finalize D1 schema and R2 key conventions.
3. Build the chunking and ingestion pipeline with one sample text.
4. Ship the reader MVP with translation switching.
5. Add auth and premium access control.
6. Integrate Stripe and entitlement syncing.
7. Add notes and Ask AI.
8. Build admin ingestion and translation generation tools.
9. Harden observability, tests, caching, and deployment.

## Definition of Done for v1

Version 1 should be considered complete when:

- users can discover books, open chapters, and switch translation styles reliably
- premium content is enforced through account and subscription state
- notes and AI assistance work on published content without breaking the reading flow
- admins can add and publish new content through supported workflows
- the system can be deployed, monitored, and operated without manual data repair
