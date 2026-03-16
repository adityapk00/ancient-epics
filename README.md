# Ancient Epics

Ancient Epics is a premium reading platform for classical literature. It combines curated source texts, multiple AI-generated translation styles, and a reader built for comparison without forcing every translation to mirror the source chunk-for-chunk.

## Features

- Side-by-side reading with translation-owned passage boundaries and explicit source anchors.
- Multiple AI translations, from line-faithful renderings to broader interpretive versions.
- Contextual AI assistance for vocabulary, history, and thematic explanation.
- Private notes anchored to specific source or translation passages.
- Subscription-ready access control backed by Stripe.

## Technology Stack

Ancient Epics is built on Cloudflare-first infrastructure.

| Component      | Technology                                     |
| :------------- | :--------------------------------------------- |
| Monorepo       | pnpm workspaces                                |
| Frontend       | React, Vite, TypeScript, Tailwind CSS          |
| API / Backend  | Cloudflare Workers with Hono                   |
| Database       | Cloudflare D1                                  |
| Object Storage | Cloudflare R2                                  |
| AI Engine      | Cloudflare Workers AI / external LLM providers |
| Payments       | Stripe                                         |

## Content Model

- Source chapters are stored as ordered original chunks.
- Every translation stores its own ordered translation chunks.
- Each translation chunk points back to the source chunks it covers through source anchors.
- This allows one translation to be line-by-line while another groups several source lines into one larger passage.

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm

### Install

```bash
pnpm install
```

### Seed local D1 and R2 state

```bash
pnpm seed:local
```

If you need a clean reset:

```bash
pnpm seed:local:nuke
```

### Run the apps

```bash
pnpm dev
```

- Frontend: http://127.0.0.1:5173
- API: http://127.0.0.1:8787

## Project Structure

```text
apps/
	api/        Cloudflare Worker API, D1 migrations, local seed tooling
	web/        React + Vite frontend
packages/
	shared/     Shared TypeScript contracts and R2 helpers
```

## Scripts

- pnpm dev
- pnpm build
- pnpm lint
- pnpm typecheck
- pnpm format
- pnpm seed:local
- pnpm seed:local:password
- pnpm seed:local:nuke
- pnpm smoke

`pnpm smoke` runs against an isolated Wrangler persistence directory, so it does not wipe your normal local D1/R2 state under `.wrangler/state`.

If you want to keep the smoke-test state around for debugging, point it at a fixed directory:

```bash
SMOKE_PERSIST_TO=/tmp/ancient-epics-smoke pnpm smoke
```

## Environment Configuration

- Local seed keys: `pnpm seed:local` reads `OPENROUTER_API_KEY` and `GEMINI_API_KEY` from the repo root `.env` and seeds them into local `app_settings`.
- Internal local-state override: scripts use `AE_LOCAL_PERSIST_TO` to point Wrangler local D1/R2 commands at a non-default persistence directory. `pnpm smoke` sets this automatically for its isolated run.
- Frontend: copy apps/web/.env.example to apps/web/.env if you want to override the API origin.
- API: copy apps/api/.dev.vars.example to apps/api/.dev.vars and add local secrets.
