# 🏛️ Ancient Epics

Ancient Epics is a premium reading platform designed to bring classical literature into the modern age. By leveraging AI-generated translations and a specialized reading interface, we make texts like the _Iliad_, the _Epic of Gilgamesh_, and Shakespeare accessible and engaging for anyone.

## ✨ Features

- **Side-by-Side Reading**: A unique, synchronized reading experience that keeps original text and translations perfectly aligned.
- **Multiple AI Translations**: Choose your flavor of translation—from literal accuracy and preserved meter to modern prose and atmospheric adaptations.
- **Contextual AI Assistance**: High-powered "Ask AI" feature to explain historical context, complex vocabulary, or thematic elements on the fly.
- **Personalized Notes**: Save private notes anchored to specific verses or paragraphs.
- **Premium Experience**: Gated content with Stripe-backed subscriptions.

---

## 🛠️ Technology Stack

Ancient Epics is built on the **Cloudflare Edge** for maximum performance and global scalability.

| Component          | Technology                            |
| :----------------- | :------------------------------------ |
| **Monorepo**       | `pnpm` Workspaces                     |
| **Frontend**       | React, Vite, TypeScript, Tailwind CSS |
| **API / Backend**  | Cloudflare Workers (Hono)             |
| **Database**       | Cloudflare D1 (SQLite at the edge)    |
| **Object Storage** | Cloudflare R2                         |
| **AI Engine**      | Cloudflare Workers AI (LLMs)          |
| **Payments**       | Stripe                                |

---

## 🚀 Getting Started

Follow these steps to set up the project locally.

### 1. Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [pnpm](https://pnpm.io/installation) (`npm install -g pnpm`)

### 2. Installation

Clone the repository and install dependencies:

```bash
pnpm install
```

### 3. Local Database & Storage Setup

Initialize your local Cloudflare D1 database and R2 storage with sample data:

```bash
pnpm seed:local
```

> [!TIP]
> If you ever need to completely wipe your local database and start fresh, run:
> `pnpm seed:nuke`

### 4. Development Mode

Start both the API and the Web frontend concurrently:

```bash
pnpm dev
```

- **Frontend**: [http://127.0.0.1:5173](http://127.0.0.1:5173)
- **API**: [http://127.0.0.1:8787](http://127.0.0.1:8787)

---

## 📂 Project Structure

```text
├── apps/
│   ├── api/        # Cloudflare Worker API (Hono)
│   └── web/        # React + Vite frontend
├── packages/
│   └── shared/     # Shared TypeScript types and utilities
├── package.json    # Root scripts and workspace config
└── pnpm-workspace.yaml
```

---

## 📜 Available Scripts

- `pnpm dev`: Run all apps in development mode.
- `pnpm build`: Build all applications for production.
- `pnpm lint`: Run ESLint across the entire monorepo.
- `pnpm typecheck`: Run TypeScript type checking.
- `pnpm seed:local`: Apply migrations and seed local D1/R2.
- `pnpm seed:nuke`: Delete local D1/R2 state.

---

## 📝 Environment Configuration

- **Frontend**: Copy `apps/web/.env.example` to `apps/web/.env`.
- **API**: Copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars` and add your development secrets (Stripe keys, etc.).

---

## 🤝 Contributing

Ancient Epics is built with a focus on high-quality typography and a seamless reading experience. Please ensure any UI changes are tested on both mobile and desktop viewports.
