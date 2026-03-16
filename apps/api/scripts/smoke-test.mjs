#!/usr/bin/env node
/**
 * Smoke test for the Ancient Epics API.
 *
 * Usage:  pnpm smoke        (from repo root)
 *         node scripts/smoke-test.mjs   (from apps/api)
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, "..");
const PORT = 8688;
const smokePersistOverride = process.env.SMOKE_PERSIST_TO?.trim();
const smokePersistTo = smokePersistOverride
  ? path.resolve(smokePersistOverride)
  : mkdtempSync(path.join(os.tmpdir(), "ancient-epics-smoke-"));
const shouldCleanupPersistTo = !smokePersistOverride;
const smokeEnv = { ...process.env, AE_LOCAL_PERSIST_TO: smokePersistTo };

let passed = 0;
let failed = 0;
const failures = [];
let server;

function assert(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✅  ${label}`);
    return;
  }

  failed += 1;
  const message = detail ? `${label} — ${detail}` : label;
  failures.push(message);
  console.log(`  ❌  ${message}`);
}

async function api(method, urlPath, body) {
  const url = `http://127.0.0.1:${PORT}${urlPath}`;
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  return { status: response.status, json };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runNodeScript(scriptName, label) {
  const result = spawnSync("node", [path.join(apiRoot, "scripts", scriptName)], {
    cwd: apiRoot,
    env: smokeEnv,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 1}.`);
  }
}

function ensurePersistParentExists() {
  mkdirSync(path.dirname(smokePersistTo), { recursive: true });
}

function cleanupPersistDir() {
  if (!shouldCleanupPersistTo || !existsSync(smokePersistTo)) {
    return;
  }

  rmSync(smokePersistTo, { recursive: true, force: true });
}

async function stopServer() {
  if (!server || server.killed) {
    return;
  }

  server.kill("SIGTERM");
  await sleep(500);
}

async function startServer() {
  console.log(`🚀  Starting Wrangler dev server on port ${PORT}…`);
  server = spawn(
    "pnpm",
    ["exec", "wrangler", "dev", "--port", String(PORT), "--persist-to", smokePersistTo, "--ip", "127.0.0.1"],
    {
      cwd: apiRoot,
      env: smokeEnv,
      stdio: "pipe",
    },
  );

  let ready = false;

  await new Promise((resolve, reject) => {
    const onData = (chunk) => {
      const text = chunk.toString();
      if (text.includes("Ready on")) {
        ready = true;
        resolve();
      }
    };

    const onExit = (code, signal) => {
      if (!ready) {
        reject(new Error(`Wrangler dev exited before startup (code: ${code ?? "null"}, signal: ${signal ?? "null"}).`));
      }
    };

    server.stdout.on("data", onData);
    server.stderr.on("data", onData);
    server.once("exit", onExit);

    setTimeout(() => {
      if (!ready) {
        reject(new Error("Timed out waiting for Wrangler to start."));
      }
    }, 30_000);
  });

  console.log("✔  Server is ready.\n");
}

function buildChapterRawResponse(chapter, translatedText) {
  return JSON.stringify({
    chapterTitle: chapter.title,
    notes: `Saved by smoke test for ${chapter.title}.`,
    chunks: [
      {
        originalText: chapter.sourceText,
        translatedText,
        type: chapter.sourceText.includes("\n") ? "verse" : "prose",
      },
    ],
  });
}

try {
  ensurePersistParentExists();

  console.log(`\n🧪  Using isolated smoke state at ${smokePersistTo}`);
  if (shouldCleanupPersistTo) {
    console.log("🧹  Smoke state will be deleted after the run.");
  } else {
    console.log("🗂️  Keeping smoke state after the run because SMOKE_PERSIST_TO is set.");
  }

  console.log("\n🧹  Nuking local D1 + R2 state…");
  runNodeScript("seed-nuke.mjs", "seed:nuke");

  console.log("🌱  Re-seeding…");
  runNodeScript("seed-local.mjs", "seed:local");

  await startServer();

  console.log("─── Health ───");
  {
    const { status, json } = await api("GET", "/api/health");
    assert("GET /api/health returns 200", status === 200);
    assert("health ok=true", json.ok === true);
    assert("health has environment", json.data?.environment === "development");
  }

  console.log("\n─── Public Reads ───");
  {
    const books = await api("GET", "/api/books");
    assert("GET /api/books returns 200", books.status === 200);
    assert("books array is non-empty", books.json.data?.books?.length > 0);
    assert("iliad exists in list", books.json.data?.books?.some((book) => book.slug === "iliad") === true);

    const book = await api("GET", "/api/books/iliad");
    assert("GET /api/books/iliad returns 200", book.status === 200);
    assert("public book has chapters", book.json.data?.chapters?.length > 0);
    assert("public book has translations", book.json.data?.translations?.length > 0);

    const chapter = await api("GET", "/api/books/iliad/chapters/book-1-the-rage?translation=verse-meaning");
    assert("GET reader chapter returns 200", chapter.status === 200);
    assert("reader chapter has original text", typeof chapter.json.data?.original?.fullText === "string");
    assert("reader chapter includes selected translation", chapter.json.data?.translation?.translation?.slug === "verse-meaning");

    const translation = await api("GET", "/api/books/iliad/chapters/book-1-the-rage/translations/verse-meaning");
    assert("GET published translation alias returns 200", translation.status === 200);
    assert("published translation has chunks", Array.isArray(translation.json.data?.content?.chunks));
  }

  console.log("\n─── Admin Settings ───");
  {
    const { status, json } = await api("GET", "/api/admin/settings");
    assert("GET /api/admin/settings returns 200", status === 200);
    assert("settings has openrouter_api_key", json.data?.settings?.openrouter_api_key !== undefined);
    assert("settings has default_provider", json.data?.settings?.default_provider !== undefined);
    assert("settings has default_model", json.data?.settings?.default_model !== undefined);
    assert("settings has default_prompt", json.data?.settings?.default_prompt !== undefined);
  }

  {
    const { status, json } = await api("PUT", "/api/admin/settings", {
      settings: {
        openrouter_api_key: "sk-or-smoke-test",
        default_provider: "openrouter",
        default_model: "openai/gpt-4o-mini",
        default_prompt: "Return compact JSON.",
      },
    });
    assert("PUT /api/admin/settings returns 200", status === 200);
    assert("updated keys returned", json.data?.updated?.length === 4);

    const { json: after } = await api("GET", "/api/admin/settings");
    assert("API key persisted", after.data?.settings?.openrouter_api_key === "sk-or-smoke-test");
    assert("provider persisted", after.data?.settings?.default_provider === "openrouter");
    assert("model persisted", after.data?.settings?.default_model === "openai/gpt-4o-mini");
    assert("prompt persisted", after.data?.settings?.default_prompt === "Return compact JSON.");
  }

  console.log("\n─── Admin Bootstrap ───");
  {
    const { status, json } = await api("GET", "/api/admin/bootstrap");
    assert("GET /api/admin/bootstrap returns 200", status === 200);
    assert("bootstrap has books", json.data?.books?.length > 0);
    assert("bootstrap has settings", typeof json.data?.settings?.default_model === "string");
  }

  console.log("\n─── Book + Translation Workflow ───");
  let createdTranslationId = null;
  {
    const createBook = await api("POST", "/api/admin/books", {
      title: "Smoke Book",
      author: "Smoke Tester",
      originalLanguage: "English",
      description: "Created during the smoke test.",
      chapters: [
        {
          position: 1,
          title: "Book One",
          slug: "book-one",
          sourceText: "First line of the source.\nSecond line of the source.",
        },
      ],
    });
    assert("POST /api/admin/books returns 201", createBook.status === 201);
    assert("created book slug is auto-generated from the title", createBook.json.data?.book?.slug === "smoke-book");
    assert("created book starts with no translations", createBook.json.data?.book?.translations?.length === 0);
    assert("created book has one chapter", createBook.json.data?.chapters?.length === 1);

    const updateBook = await api("PUT", "/api/admin/books/smoke-book", {
      title: "Smoke Book Revised",
      description: "Updated during the smoke test.",
    });
    assert("PUT /api/admin/books/smoke-book returns 200", updateBook.status === 200);
    assert("updated book title is returned", updateBook.json.data?.book?.title === "Smoke Book Revised");

    const createTranslation = await api("POST", "/api/admin/books/smoke-book/translations", {
      title: "Smoke Translation",
      description: "Created during the smoke test.",
      provider: "google",
      model: "test-model",
      prompt: "Return JSON only.",
      contextBeforeChapterCount: 0,
      contextAfterChapterCount: 0,
    });
    assert("POST /api/admin/books/smoke-book/translations returns 201", createTranslation.status === 201);
    assert("created translation has chapters", createTranslation.json.data?.chapters?.length === 1);
    createdTranslationId = createTranslation.json.data?.id ?? null;

    const chapter = createTranslation.json.data?.chapters?.[0];
    assert("created translation exposes chapter id", typeof chapter?.chapterId === "string");

    const saveChapter = await api("PUT", `/api/admin/translations/${createdTranslationId}/chapters/${chapter.chapterId}`, {
      rawResponse: buildChapterRawResponse(chapter, "Smoke translation of the source lines."),
    });
    assert("saving chapter returns 200", saveChapter.status === 200);
    assert("saved chapter count is updated", saveChapter.json.data?.savedChapterCount === 1);
    assert(
      "chapter is marked saved",
      saveChapter.json.data?.chapters?.[0]?.status === "saved",
      `got "${saveChapter.json.data?.chapters?.[0]?.status}"`,
    );

    const validate = await api("GET", `/api/admin/translations/${createdTranslationId}/validate`);
    assert("validation returns 200", validate.status === 200);
    assert("validation passes", validate.json.data?.isValid === true);

    const publish = await api("POST", `/api/admin/translations/${createdTranslationId}/publish`);
    assert("publish returns 200", publish.status === 200);
    assert("translation is published", publish.json.data?.status === "published");

    const publicBook = await api("GET", "/api/books/smoke-book");
    assert("published smoke book is public", publicBook.status === 200);
    assert(
      "public smoke book exposes published translation",
      publicBook.json.data?.translations?.some((translation) => translation.slug === "smoke-translation") === true,
    );

    const publicChapter = await api("GET", "/api/books/smoke-book/chapters/book-one?translation=smoke-translation");
    assert("public smoke chapter returns 200", publicChapter.status === 200);
    assert("public smoke chapter includes translation", publicChapter.json.data?.translation?.translation?.slug === "smoke-translation");

    const unpublish = await api("POST", `/api/admin/translations/${createdTranslationId}/unpublish`);
    assert("unpublish returns 200", unpublish.status === 200);
    assert("translation returns to draft", unpublish.json.data?.status === "draft");

    const missingPublicBook = await api("GET", "/api/books/smoke-book");
    assert("unpublished smoke book is hidden from public", missingPublicBook.status === 404);

    const deleteTranslation = await api("DELETE", `/api/admin/translations/${createdTranslationId}`);
    assert("delete translation returns 200", deleteTranslation.status === 200);

    const deleteBook = await api("DELETE", "/api/admin/books/smoke-book");
    assert("delete book returns 200", deleteBook.status === 200);
  }

  console.log("\n─── 404 Handling ───");
  {
    const { status, json } = await api("GET", "/api/books/nonexistent");
    assert("unknown book returns 404", status === 404);
    assert("error payload has ok=false", json.ok === false);
  }

  console.log(`\n✅  Smoke summary: ${passed} passed, ${failed} failed.`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const failure of failures) {
      console.log(`- ${failure}`);
    }
    process.exitCode = 1;
  }
} catch (error) {
  console.error("\n❌  Smoke test aborted:");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await stopServer();
  cleanupPersistDir();
}
