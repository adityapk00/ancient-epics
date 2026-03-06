## Product Overview: Ancient Epics

**Mission:** To make ancient and culturally significant texts (e.g., _Epic of Gilgamesh_, Homer's _Iliad_, Shakespeare's plays) accessible and engaging for modern readers through customizable, side-by-side AI-generated translations.

**Target Audience:** Students, history enthusiasts, casual readers, and academics who want to appreciate classic literature without the barrier of archaic language.

**Monetization:** SaaS Subscription model (Free tier, Trial, Paid tier) managed via Stripe.

## Technical Stack

| Component                 | Technology Choice         | Purpose                                                                                   |
| ------------------------- | ------------------------- | ----------------------------------------------------------------------------------------- |
| **Frontend Framework**    | React + Vite + TypeScript | Fast local development, strict type safety, component-based UI.                           |
| **Styling**               | Tailwind CSS              | Rapid, utility-first styling (crucial for responsive reading views and dark mode).        |
| **Hosting & CDN**         | Cloudflare Pages          | Serving the static React frontend globally with low latency.                              |
| **Backend API**           | Cloudflare Workers        | Serverless functions handling auth, billing routing, and database queries.                |
| **Database (Relational)** | Cloudflare D1             | Storing user profiles, subscription states, private notes, and app metadata.              |
| **Storage (Static)**      | Cloudflare R2 or KV       | Storing the pre-generated text chunks (Originals and Translations) for instant retrieval. |
| **AI Integration**        | Cloudflare Workers AI     | Powering the dynamic "Ask AI" feature for contextual text explanations.                   |

## Core UI & Rendering Strategy

The defining feature of the app is the side-by-side reading experience. To avoid the performance pitfalls and state-management nightmares of synchronizing two separate scrollbars, the app will utilize a **Single-Scrollbar, Chunked Row Layout**.

- **Data Structure:** Texts are broken down into logical "chunks" (e.g., a stanza, a pair of lines, a specific character's dialogue).
- **DOM Structure:** A main scrolling container holds multiple parent `<div>` elements (rows). Inside each parent row, Flexbox or CSS Grid places two child `<div>` elements side-by-side: the Original text on the left, and the Translation on the right.
- **Alignment:** Because the original and translation are housed in the same horizontal row, they naturally stretch the parent container's height to accommodate the longest text block. This guarantees permanent vertical alignment as the user scrolls, requiring zero JavaScript scroll-syncing.
- **Mobile Responsiveness:** On narrow screens, a simple CSS media query will stack the Flexbox/Grid columns vertically (Original -> Translation -> Original -> Translation).

## Key Features & User Flows

### 1. Library & Reading Experience

- **Home Dashboard:** A visually appealing, scrollable library of available epics.
- **Translation Selection:** Upon opening a book, a dropdown menu allows the user to select their preferred pre-generated AI translation style (e.g., Verse/Preserved Meter, Prose/Modern Sensibilities, Literal Accuracy).
- **Contextual Tooling ("Ask AI" & Notes):** A clean, margin-free reading view. When a user highlights a text selection, a lightweight context menu appears offering two actions:
- **Save Note:** Opens a modal to write and save a private note anchored to that specific text chunk.
- **Ask AI:** Sends the highlighted text to an LLM via Cloudflare Workers AI to explain historical context, vocabulary, or thematic meaning.

### 2. User Accounts & Monetization

- **Authentication:** Users can browse the landing page and potentially read a free sample chapter, but must sign up/log in to access full texts and save notes.
- **Subscription Management:** A dedicated settings page where users can view their current tier (Free, Trial, Active Paid, Expired) and manage their Stripe billing details securely.
- **Access Control:** The Cloudflare Worker API will check the user's D1 database record to verify an active subscription before fetching premium text chunks from R2.

### 3. Admin Capabilities

- **Content Management:** A secure, admin-only route/dashboard to upload new original texts and upload their corresponding pre-generated translation variants.

---

# Data Architecture & Storage Design

This document details the storage separation, database schemas, object storage layout, and the admin workflow for the Ancient Epics application.

## 1. Storage Split: Cloudflare D1 vs. R2

Due to the fundamental difference between dynamic user data and static text content, we split the storage to maximize speed, cacheability, and cost-efficiency.

### **Cloudflare D1 (Relational Database)**

D1 is reserved for **dynamic, queryable data**.

- **User Data:** Authentication profiles, subscription status (Stripe customer IDs), permissions.
- **App Metadata:** Information about the books available, the chapters they contain, and the available translation variants.
- **User Notes/Highlights:** Notes that users save, anchored to specific parts of text.

### **Cloudflare R2 (Object Storage) or KV**

R2 is reserved for **immutable, heavy text content and assets**.

- **Static Assets:** Book cover images, author portraits.
- **Text Chunks (JSON):** The actual epic texts (both original language and the various translations). Because texts don't change once finalized, they run perfectly out of static JSON files cached globally by Cloudflare's CDN.

---

## 2. Table Schemas (Cloudflare D1)

```sql
-- Represents an Epic
CREATE TABLE books (
    id TEXT PRIMARY KEY,           -- UUID
    slug TEXT UNIQUE NOT NULL,     -- e.g., 'iliad'
    title TEXT NOT NULL,
    author TEXT,
    original_language TEXT,
    description TEXT,
    cover_image_url TEXT,
    is_published BOOLEAN DEFAULT false
);

-- Represents the structural breakdown of a book
CREATE TABLE chapters (
    id TEXT PRIMARY KEY,
    book_id TEXT REFERENCES books(id),
    slug TEXT NOT NULL,            -- e.g., 'book-1-the-rage'
    position INTEGER NOT NULL,     -- For ordering (1, 2, 3...)
    title TEXT NOT NULL
);

-- Represents a specific flavor/style of translation for a book
CREATE TABLE translations (
    id TEXT PRIMARY KEY,
    book_id TEXT REFERENCES books(id),
    slug TEXT NOT NULL,            -- e.g., 'verse-meter'
    name TEXT NOT NULL,            -- "Verse / Preserve Meter"
    description TEXT,              -- "Maintains the original rhythmic structure..."
    ai_system_prompt TEXT,         -- The hidden guide prompt used by the Admin
    is_published BOOLEAN DEFAULT false
);

-- User accounts
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    stripe_customer_id TEXT,
    subscription_status TEXT       -- 'free', 'trial', 'active', 'expired'
);

-- User-generated notes anchored to the text
CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    book_id TEXT REFERENCES books(id),
    chapter_id TEXT REFERENCES chapters(id),
    chunk_id TEXT NOT NULL,        -- The exact text block ID this note is about
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 3. Storage File Layout (Cloudflare R2)

Instead of fetching massive books all at once, the frontend fetches them on a **per-chapter** basis. We split the original text and its translations into separate files.

**Directory Structure in R2:**

```text
/epics
  /iliad
    /book-1
      original.json
      trans_verse_meter.json
      trans_verse_meaning.json
      trans_prose_modern.json
      trans_prose_atmosphere.json
    /book-2
      original.json
      ...
```

### **Aligning Text: The "Chunk ID" System**

To keep the UI perfectly aligned without heavy CPU processing, every paragraph, verse, or stanza receives a unique, permanent `id`. The translation files use these identical IDs to map directly to the original text.

**`original.json`** (Fetched when a user opens the chapter)

```json
{
  "book_slug": "iliad",
  "chapter_slug": "book-1",
  "chunks": [
    {
      "id": "c1",
      "type": "verse",
      "text": "Mῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος"
    },
    {
      "id": "c2",
      "type": "verse",
      "text": "οὐλομένην, ἣ μυρί᾽ Ἀχαιοῖς ἄλγε᾽ ἔθηκε,"
    },
    {
      "id": "c3",
      "type": "verse",
      "text": "πολλὰς δ᾽ ἰφθίμους ψυχὰς Ἄϊδι προΐαψεν"
    }
  ]
}
```

**`trans_verse_meaning.json`** (Fetched alongside the original, or dynamically swapped)

```json
{
  "translation_slug": "verse-meaning",
  "chunks": {
    "c1": "Sing, goddess, the anger of Peleus' son Achilles",
    "c2": "and its devastation, which put pains thousandfold upon the Achaeans,",
    "c3": "hurled in their multitudes to the house of Hades strong souls"
  }
}
```

- **Why this works seamlessly in the UI:** When the user switches translations from "Prose" to "Verse", the React app simply fetches the new `trans_verse_meaning.json` file. It iterates over the original chunks array, and uses the `id` to instantly look up the corresponding translated string in the dictionary `translation_data.chunks[chunk.id]`.

---

## 4. Admin Workflow: "Chunking" and "Guiding"

How do books get added and translations get generated?

### **Step 1: Uploading & Chunking the Original Text**

1. The Admin goes to a dashboard and creates a new Book record.
2. They upload raw text files containing the chapters in the original language.
3. The backend script **chunks** the text. Depending on the book type, the chunk logic splits by `\n\n` (for prose) or `\n` (for verse).
4. The backend generates sequential IDs (e.g., `c1`, `c2`) and outputs the `original.json` file to R2.

### **Step 2: Defining Translations**

1. The Admin creates a new "Translation Type" in the dashboard.
2. Here, they write the **AI Guide (System Prompt)**.
   - _Example:_ `"Translate the following Ancient Greek chunk of the Iliad into English. You must strongly prioritize capturing the chaotic, bloody atmosphere of the scene. Make it sound like modern slam poetry. Use the previous and next chunks provided for context, but ONLY output the translation for the target chunk."\*

### **Step 3: Generating and Saving**

1. The Admin clicks "Generate Translation".
2. A Cloudflare Worker loops through the chunks in `original.json`.
3. _Crucial:_ Because LLMs need context to translate properly, the worker sends a "sliding window" to the API:
   - Content of Chunk n-1 (Context)
   - **Content of Chunk n (Target)**
   - Content of Chunk n+1 (Context)
4. The LLM translates the Target.
5. The Worker saves the output into the key/value dictionary format under the same chunk `id`.
6. Once the entire chapter is processed, the worker uploads the final `trans_prose_atmosphere.json` to R2.

### **Step 4: Quality Checks**

The Admin can preview the file in an internal UI, manually correcting any weird AI hallucinations straight in the R2 JSON file, before finally flipping `is_published = true` in the D1 Database.
