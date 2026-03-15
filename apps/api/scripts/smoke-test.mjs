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
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, "..");
const PORT = 8688; // avoid colliding with a running dev server on 8787
const smokePersistOverride = process.env.SMOKE_PERSIST_TO?.trim();
const smokePersistTo = smokePersistOverride
  ? path.resolve(smokePersistOverride)
  : mkdtempSync(path.join(os.tmpdir(), "ancient-epics-smoke-"));
const shouldCleanupPersistTo = !smokePersistOverride;
const smokeEnv = { ...process.env, AE_LOCAL_PERSIST_TO: smokePersistTo };

// ── Helpers ──────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];
let server;

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
      if (ready) {
        return;
      }

      reject(new Error(`Wrangler dev exited before startup (code: ${code ?? "null"}, signal: ${signal ?? "null"}).`));
    };

    server.stdout.on("data", onData);
    server.stderr.on("data", onData);
    server.once("exit", onExit);

    setTimeout(() => {
      if (ready) {
        return;
      }

      reject(new Error("Timed out waiting for Wrangler to start."));
    }, 30_000);
  });

  console.log("✔  Server is ready.\n");
}

// ── Tests ────────────────────────────────────────────────────

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
    assert("chapter has no status field", ch?.status === undefined, "chapter status should not be exposed");
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
    assert(
      "first translation chunk has original text",
      typeof json.data?.content?.chunks?.[0]?.originalText === "string",
    );
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
    assert("created book slug is auto-generated from the title", json.data?.book?.slug === "smoke-book");
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
    assert("session stays on the saved chapter", saveResult.json.data?.session?.currentChapterIndex === 0);
  }

  {
    const { status, json } = await api("POST", "/api/admin/ingestion/sessions", {
      title: "Smoke Chunk Reconstruction Session",
      sourceMode: "paste",
      model: "openai/gpt-4o-mini",
      prompt: "Return JSON only.",
      chapters: [
        {
          position: 0,
          title: "Split Chapter",
          slug: "split-chapter",
          sourceText: "Alpha line.\nBeta line.",
          sourceChapterSlug: null,
        },
      ],
    });

    assert("POST chunk reconstruction session returns 201", status === 201);
    assert("chunk reconstruction session has one chapter", json.data?.chapters?.length === 1);

    const sessionId = json.data.id;
    const splitChunkResponse = JSON.stringify({
      chapterTitle: "Split Chapter",
      chunks: [
        {
          originalText: "Alpha line.\n",
          translatedText: "Alpha translated.\n",
          type: "verse",
        },
        {
          originalText: "Beta line.",
          translatedText: "Beta translated.",
          type: "verse",
        },
      ],
    });

    const saveResult = await api("PUT", `/api/admin/ingestion/sessions/${sessionId}/chapters/0/save`, {
      rawResponse: splitChunkResponse,
    });
    assert("saving split chunks returns 200", saveResult.status === 200);
    assert("split chunk chapter is marked saved", saveResult.json.data?.chapter?.status === "saved");
    assert("split chunk chapter has no error message", saveResult.json.data?.chapter?.errorMessage === null);
    assert(
      "split chunk chapter preserves both chunk boundaries",
      saveResult.json.data?.chapter?.translationDocument?.chunks?.length === 2,
    );
    assert(
      "split chunk chapter reconstructs source text without inserted blank lines",
      saveResult.json.data?.chapter?.translationDocument?.chunks?.map((chunk) => chunk.originalText).join("") ===
        "Alpha line.\nBeta line.",
    );
  }

  {
    const { status, json } = await api("POST", "/api/admin/ingestion/sessions", {
      title: "Smoke Reconstruction Warning Session",
      sourceMode: "paste",
      model: "openai/gpt-4o-mini",
      prompt: "Return JSON only.",
      chapters: [
        {
          position: 0,
          title: "Warning Chapter",
          slug: "warning-chapter",
          sourceText: "Alpha line.\nBeta line.",
          sourceChapterSlug: null,
        },
      ],
    });

    assert("POST reconstruction warning session returns 201", status === 201);
    assert("reconstruction warning session has one chapter", json.data?.chapters?.length === 1);

    const sessionId = json.data.id;
    const mismatchedChunkResponse = JSON.stringify({
      chapterTitle: "Warning Chapter",
      chunks: [
        {
          originalText: "Alpha line.\n",
          translatedText: "Alpha translated.\n",
          type: "verse",
        },
        {
          originalText: "Beta line. Added drift.",
          translatedText: "Beta translated.",
          type: "verse",
        },
      ],
    });

    const saveResult = await api("PUT", `/api/admin/ingestion/sessions/${sessionId}/chapters/0/save`, {
      rawResponse: mismatchedChunkResponse,
    });
    assert("saving reconstruction warning chapter returns 200", saveResult.status === 200);
    assert("reconstruction warning chapter is still marked saved", saveResult.json.data?.chapter?.status === "saved");
    assert(
      "reconstruction warning chapter does not surface a save error",
      saveResult.json.data?.chapter?.errorMessage === null,
    );

    const createTranslationResult = await api("POST", "/api/admin/books/smoke-book/translations", {
      title: "Smoke Warning Translation",
      description: "Created for warning validation.",
      model: "openai/gpt-4o-mini",
      prompt: "Return JSON only.",
      contextBeforeChapterCount: 0,
      contextAfterChapterCount: 0,
    });
    assert("POST warning translation returns 201", createTranslationResult.status === 201);

    const translationId = createTranslationResult.json.data?.id;
    const linkedSessionId = createTranslationResult.json.data?.currentSession?.id;
    const linkedChapterPosition = createTranslationResult.json.data?.currentSession?.chapters?.[0]?.position;
    assert("warning translation has id", Boolean(translationId));
    assert("warning translation has session id", Boolean(linkedSessionId));
    assert("warning translation has a chapter position", typeof linkedChapterPosition === "number");

    const linkedSaveResult = await api(
      "PUT",
      `/api/admin/ingestion/sessions/${linkedSessionId}/chapters/${linkedChapterPosition}/save`,
      {
        rawResponse: mismatchedChunkResponse,
      },
    );
    assert("saving linked warning chapter returns 200", linkedSaveResult.status === 200);
    assert("linked warning chapter is marked saved", linkedSaveResult.json.data?.chapter?.status === "saved");

    const validationResult = await api("GET", `/api/admin/translations/${translationId}/validate`);
    assert("warning translation validate returns 200", validationResult.status === 200);
    assert("warning translation remains valid", validationResult.json.data?.isValid === true);
    assert(
      "warning translation reports one reconstruction warning",
      validationResult.json.data?.issues?.some(
        (issue) =>
          issue.level === "warning" &&
          issue.message === "Translation chunk original text does not exactly reconstruct the chapter source text.",
      ) === true,
    );
  }

  {
    const createTranslationResult = await api("POST", "/api/admin/books/iliad/translations", {
      title: "Smoke Iliad Translation",
      description: "Created during smoke validation.",
      model: "openai/gpt-4o-mini",
      prompt: "Return JSON only.",
      contextBeforeChapterCount: 1,
      contextAfterChapterCount: 0,
    });
    assert("POST book translation returns 201", createTranslationResult.status === 201);
    assert(
      "created translation slug is auto-generated from the title",
      createTranslationResult.json.data?.slug === "smoke-iliad-translation",
    );

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
} catch (error) {
  failed++;
  const detail = error instanceof Error ? error.message : String(error);
  failures.push(`Smoke test setup/runtime error — ${detail}`);
  console.error(`\n❌  Smoke test aborted: ${detail}`);
} finally {
  // ── Teardown ─────────────────────────────────────────────────

  await stopServer();
  cleanupPersistDir();

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
