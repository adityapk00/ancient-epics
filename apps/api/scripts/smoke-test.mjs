#!/usr/bin/env node
/**
 * Smoke test for the Ancient Epics API.
 *
 * Usage:  pnpm smoke        (from repo root)
 *         node scripts/smoke-test.mjs   (from apps/api)
 *
 * What it does:
 *   1. Nukes local D1 + R2 state
 *   2. Re-seeds from scratch
 *   3. Starts the Wrangler dev server on a random-ish port
 *   4. Runs assertions against every endpoint
 *   5. Tears down the server
 *   6. Prints a pass / fail summary
 */

import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, "..");
const PORT = 8688; // avoid colliding with a running dev server on 8787

// ── Helpers ──────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ✅  ${label}`);
  } else {
    failed++;
    const msg = detail ? `${label} — ${detail}` : label;
    failures.push(msg);
    console.log(`  ❌  ${msg}`);
  }
}

async function api(method, urlPath, body) {
  const url = `http://127.0.0.1:${PORT}${urlPath}`;
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const json = await res.json();
  return { status: res.status, json };
}

function runSync(args) {
  const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
    cwd: apiRoot,
    stdio: "pipe",
  });
  if (result.status !== 0) {
    console.error(result.stderr?.toString());
    process.exit(1);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Setup ────────────────────────────────────────────────────

console.log("\n🧹  Nuking local D1 + R2 state…");
spawnSync("node", [path.join(apiRoot, "scripts", "seed-nuke.mjs")], {
  cwd: apiRoot,
  stdio: "inherit",
});

console.log("🌱  Re-seeding…");
spawnSync("node", [path.join(apiRoot, "scripts", "seed-local.mjs")], {
  cwd: apiRoot,
  stdio: "inherit",
});

console.log(`🚀  Starting Wrangler dev server on port ${PORT}…`);
const server = spawn("pnpm", ["exec", "wrangler", "dev", "--port", String(PORT)], { cwd: apiRoot, stdio: "pipe" });

// Wait for "Ready" message before running tests
let ready = false;
const readyPromise = new Promise((resolve) => {
  const onData = (chunk) => {
    const text = chunk.toString();
    if (text.includes("Ready on")) {
      ready = true;
      resolve();
    }
  };
  server.stdout.on("data", onData);
  server.stderr.on("data", onData);
  // Safety timeout
  setTimeout(() => {
    if (!ready) {
      console.error("⏳  Timed out waiting for Wrangler to start.");
      server.kill();
      process.exit(1);
    }
  }, 30_000);
});

await readyPromise;
console.log("✔  Server is ready.\n");

// ── Tests ────────────────────────────────────────────────────

try {
  // ── Health ──
  console.log("─── Health ───");
  {
    const { status, json } = await api("GET", "/api/health");
    assert("GET /api/health returns 200", status === 200);
    assert("health ok=true", json.ok === true);
    assert("health has environment", json.data?.environment === "development");
  }

  // ── Public Books ──
  console.log("\n─── Public Books ───");
  {
    const { status, json } = await api("GET", "/api/books");
    assert("GET /api/books returns 200", status === 200);
    assert("books array is non-empty", json.data?.books?.length > 0);

    const iliad = json.data.books.find((b) => b.slug === "iliad");
    assert("iliad exists in list", !!iliad);
    assert('iliad has status "published"', iliad?.status === "published", `got "${iliad?.status}"`);
    assert("iliad has NO isPublished field", iliad?.isPublished === undefined, "legacy field still present");
  }

  // ── Public Book Detail ──
  console.log("\n─── Public Book Detail ───");
  {
    const { status, json } = await api("GET", "/api/books/iliad");
    assert("GET /api/books/iliad returns 200", status === 200);
    assert("book has chapters array", Array.isArray(json.data?.chapters));
    assert("book has translations array", Array.isArray(json.data?.translations));

    const ch = json.data.chapters?.[0];
    assert("chapter has status field", typeof ch?.status === "string");
    assert("chapter has NO isPublished field", ch?.isPublished === undefined, "legacy field still present on chapter");

    const tr = json.data.translations?.[0];
    assert("translation has status field", typeof tr?.status === "string");
    assert(
      "translation has NO isPublished field",
      tr?.isPublished === undefined,
      "legacy field still present on translation",
    );
  }

  // ── Chapter + R2 original ──
  console.log("\n─── Chapter Content ───");
  {
    const { status, json } = await api("GET", "/api/books/iliad/chapters/book-1-the-rage");
    assert("GET chapter returns 200", status === 200);
    assert("original has fullText", typeof json.data?.original?.fullText === "string");
    assert("original fullText is non-empty", json.data?.original?.fullText?.length > 0);
    assert("availableTranslations present", json.data?.availableTranslations?.length > 0);
  }

  // ── Translation content ──
  console.log("\n─── Translation Content ───");
  {
    const { status, json } = await api("GET", "/api/books/iliad/chapters/book-1-the-rage/translations/verse-meaning");
    assert("GET translation returns 200", status === 200);
    assert("translation has chunks array", Array.isArray(json.data?.content?.chunks));
    assert("first translation chunk has id", typeof json.data?.content?.chunks?.[0]?.id === "string");
    assert("first translation chunk has original text", typeof json.data?.content?.chunks?.[0]?.originalText === "string");
    assert(
      "first translation chunk has translated text",
      typeof json.data?.content?.chunks?.[0]?.translatedText === "string",
    );
  }

  // ── 404 for non-existent book ──
  console.log("\n─── 404 Handling ───");
  {
    const { status, json } = await api("GET", "/api/books/nonexistent");
    assert("unknown book returns 404", status === 404);
    assert("error ok=false", json.ok === false);
  }

  // ── Admin Settings GET ──
  console.log("\n─── Admin Settings ───");
  {
    const { status, json } = await api("GET", "/api/admin/settings");
    assert("GET /api/admin/settings returns 200", status === 200);
    assert("settings has openrouter_api_key", json.data?.settings?.openrouter_api_key !== undefined);
    assert("settings has default_translation_model", json.data?.settings?.default_translation_model !== undefined);
    assert("settings has admin_ingestion_model", json.data?.settings?.admin_ingestion_model !== undefined);
    assert("settings has admin_ingestion_prompt", json.data?.settings?.admin_ingestion_prompt !== undefined);
  }

  // ── Admin Settings PUT ──
  {
    const { status, json } = await api("PUT", "/api/admin/settings", {
      settings: {
        openrouter_api_key: "sk-or-smoke-test",
        default_translation_model: "anthropic/claude-3.5-sonnet",
        admin_ingestion_model: "openai/gpt-4o-mini",
      },
    });
    assert("PUT /api/admin/settings returns 200", status === 200);
    assert("updated keys returned", json.data?.updated?.length === 3);

    // Read back
    const { json: after } = await api("GET", "/api/admin/settings");
    assert("API key persisted", after.data?.settings?.openrouter_api_key === "sk-or-smoke-test");
    assert("model persisted", after.data?.settings?.default_translation_model === "anthropic/claude-3.5-sonnet");
    assert("admin ingestion model persisted", after.data?.settings?.admin_ingestion_model === "openai/gpt-4o-mini");
  }

  // ── Admin Books (includes drafts) ──
  console.log("\n─── Admin Books ───");
  {
    const { status, json } = await api("GET", "/api/admin/books");
    assert("GET /api/admin/books returns 200", status === 200);
    assert("admin books list is non-empty", json.data?.books?.length > 0);
  }

  // ── Admin Book Detail ──
  {
    const { status, json } = await api("GET", "/api/admin/books/iliad");
    assert("GET /api/admin/books/iliad returns 200", status === 200);
    assert("admin book detail has chapters", json.data?.chapters?.length > 0);
    assert("admin book detail has translations", json.data?.translations?.length > 0);
  }

  {
    const { status, json } = await api("POST", "/api/admin/books", {
      title: "Smoke Book",
      slug: "smoke-book",
      author: "Smoke Tester",
      originalLanguage: "English",
      description: "Created during the smoke test.",
      chapters: [
        {
          position: 0,
          title: "Book One",
          slug: "book-one",
          sourceText: "First line of the source.\nSecond line of the source.",
        },
      ],
    });
    assert("POST /api/admin/books returns 201", status === 201);
    assert("created book has draft status", json.data?.book?.status === "draft");
    assert("created book has one chapter", json.data?.chapters?.length === 1);
  }

  // ── Admin ingestion bootstrap + session flow ──
  console.log("\n─── Admin Ingestion ───");
  {
    const { status, json } = await api("GET", "/api/admin/ingestion/bootstrap");
    assert("GET /api/admin/ingestion/bootstrap returns 200", status === 200);
    assert("ingestion bootstrap has books", json.data?.books?.length > 0);
    assert("ingestion bootstrap has prompt setting", typeof json.data?.settings?.admin_ingestion_prompt === "string");
  }

  {
    const { status, json } = await api("POST", "/api/admin/ingestion/sessions", {
      title: "Smoke Translation Session",
      sourceMode: "paste",
      model: "openai/gpt-4o-mini",
      prompt: "Return JSON only.",
      chapters: [
        {
          position: 0,
          title: "Chapter One",
          slug: "chapter-one",
          sourceText: "Sing, goddess, the rage of Achilles.\nAnd the grief it set loose.",
          sourceChapterSlug: null,
        },
        {
          position: 1,
          title: "Chapter Two",
          slug: "chapter-two",
          sourceText: "A second short chapter for context.",
          sourceChapterSlug: null,
        },
      ],
    });

    assert("POST /api/admin/ingestion/sessions returns 201", status === 201);
    assert("created session has chapters", json.data?.chapters?.length === 2);

    const sessionId = json.data.id;
    const reviewedResponse = JSON.stringify({
      chapterTitle: "Chapter One",
      notes: "Reviewed in smoke test.",
      chunks: [
        {
          originalText: "Sing, goddess, the rage of Achilles.\nAnd the grief it set loose.",
          translatedText: "Sing, goddess, of Achilles' anger and the sorrow it unleashed.",
          type: "verse",
        },
      ],
    });

    const saveResult = await api("PUT", `/api/admin/ingestion/sessions/${sessionId}/chapters/0/save`, {
      rawResponse: reviewedResponse,
    });
    assert("saving reviewed chapter returns 200", saveResult.status === 200);
    assert("saved chapter is marked saved", saveResult.json.data?.chapter?.status === "saved");
    assert(
      "saved chapter has normalized original full text",
      saveResult.json.data?.chapter?.originalDocument?.fullText ===
        "Sing, goddess, the rage of Achilles.\nAnd the grief it set loose.",
    );
    assert(
      "saved chapter has normalized translation chunks",
      saveResult.json.data?.chapter?.translationDocument?.chunks?.length === 1,
    );
    assert("session advances to the next chapter", saveResult.json.data?.session?.currentChapterIndex === 1);
  }

  {
    const createTranslationResult = await api("POST", "/api/admin/books/iliad/translations", {
      title: "Smoke Iliad Translation",
      slug: "smoke-iliad-translation",
      description: "Created during smoke validation.",
      model: "openai/gpt-4o-mini",
      prompt: "Return JSON only.",
      contextBeforeChapterCount: 1,
      contextAfterChapterCount: 0,
    });
    assert("POST book translation returns 201", createTranslationResult.status === 201);

    const linkedTranslationId = createTranslationResult.json.data?.id;
    const translationsResult = await api("GET", "/api/admin/books/iliad/translations");
    assert("translations list returns 200", translationsResult.status === 200);
    assert(
      "translations include the linked translation",
      translationsResult.json.data?.translations?.some((translation) => translation.id === linkedTranslationId),
    );

    const validationResult = await api("GET", `/api/admin/translations/${linkedTranslationId}/validate`);
    assert("validate translation returns 200", validationResult.status === 200);
    assert("validation payload has chapters", validationResult.json.data?.chapters?.length > 0);
  }
} finally {
  // ── Teardown ─────────────────────────────────────────────────

  server.kill("SIGTERM");
  // Give it a moment to clean up
  await sleep(500);

  console.log("\n═══════════════════════════════════════════");
  console.log(`  Results:  ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("\n  Failures:");
    for (const f of failures) {
      console.log(`    • ${f}`);
    }
  }
  console.log("═══════════════════════════════════════════\n");

  process.exit(failed > 0 ? 1 : 0);
}
