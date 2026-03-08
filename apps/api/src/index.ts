import {
  APP_SETTING_KEYS,
  type AiProvider,
  type AdminBookChapterInput,
  buildOriginalChapterKey,
  buildTranslationChapterKey,
  type AdminIngestionBootstrapPayload,
  type AdminIngestionChapterInput,
  type AdminIngestionSourceMode,
  type BookDetail,
  type BookSummary,
  type ChapterPayload,
  type ChapterSummary,
  type OriginalChapterDocument,
  type ThinkingLevel,
  type TranslationChapterDocument,
  type TranslationPayload,
  type TranslationSummary,
} from "@ancient-epics/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  buildChapterInputsFromExistingStory,
  buildInitialOriginalDocument,
  createAdminIngestionSessionForBook,
  getAdminBookSourcePayload,
  getAdminIngestionSessionDetail,
  getAdminIngestionSessionRow,
  getAdminTranslationDetail,
  getSettingsMap,
  listAdminBookWorkflowSummaries,
  listAdminIngestionSessions,
  listAdminTranslations,
  normalizePastedChapterInputs,
  validateTranslation,
} from "./admin-data";
import { generateChapterWithGoogle } from "./google";
import { failure, type AppEnv, readObjectJson, success, slugify, writeObjectJson } from "./http";
import { generateChapterWithOpenRouter } from "./openrouter";
import { normalizeThinkingLevel } from "./reasoning";
import { persistGeneratedChapter } from "./translation-generation";

const app = new Hono<AppEnv>();

app.use("/api/*", async (c, next) => {
  const origin = c.env.PUBLIC_APP_URL ?? "http://127.0.0.1:5173";
  return cors({
    origin,
    allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })(c, next);
});

app.get("/api/health", (c) =>
  c.json(
    success({
      environment: c.env.APP_ENV ?? "development",
      now: new Date().toISOString(),
    }),
  ),
);

app.get("/api/books", async (c) => {
  const results = await c.env.DB.prepare(
    `
      SELECT
        id,
        slug,
        title,
        author,
        original_language AS originalLanguage,
        description,
        cover_image_url AS coverImageUrl,
        status,
        published_at AS publishedAt
      FROM books
      WHERE status = 'published'
      ORDER BY published_at DESC, title ASC
    `,
  ).all<BookSummary>();

  return c.json(success({ books: results.results ?? [] }));
});

app.get("/api/books/:bookSlug", async (c) => {
  const bookSlug = c.req.param("bookSlug");
  const book = await c.env.DB.prepare(
    `
      SELECT
        id,
        slug,
        title,
        author,
        original_language AS originalLanguage,
        description,
        cover_image_url AS coverImageUrl,
        status,
        published_at AS publishedAt
      FROM books
      WHERE slug = ? AND status = 'published'
    `,
  )
    .bind(bookSlug)
    .first<BookSummary>();

  if (!book) {
    return c.json(failure("not_found", `Book '${bookSlug}' was not found.`), 404);
  }

  const [chaptersResult, translationsResult] = await Promise.all([
    c.env.DB.prepare(
      `
        SELECT
          id,
          slug,
          position,
          title,
          is_preview AS isPreview,
          source_r2_key AS sourceR2Key,
          status,
          published_at AS publishedAt
        FROM chapters
        WHERE book_id = ?
        ORDER BY position ASC
      `,
    )
      .bind(book.id)
      .all<ChapterSummary>(),
    c.env.DB.prepare(
      `
        SELECT
          id,
          slug,
          name,
          description,
          output_r2_prefix AS outputR2Prefix,
          status
        FROM translations
        WHERE book_id = ? AND status = 'published'
        ORDER BY name ASC
      `,
    )
      .bind(book.id)
      .all<TranslationSummary>(),
  ]);

  const payload: BookDetail = {
    ...book,
    chapters: chaptersResult.results ?? [],
    translations: translationsResult.results ?? [],
  };

  return c.json(success(payload));
});

app.get("/api/books/:bookSlug/chapters/:chapterSlug", async (c) => {
  const { bookSlug, chapterSlug } = c.req.param();
  const chapter = await c.env.DB.prepare(
    `
      SELECT
        chapters.id,
        chapters.slug,
        chapters.position,
        chapters.title,
        chapters.is_preview AS isPreview,
        chapters.source_r2_key AS sourceR2Key,
        chapters.status,
        chapters.published_at AS publishedAt,
        books.id AS bookId
      FROM chapters
      JOIN books ON books.id = chapters.book_id
      WHERE books.slug = ? AND chapters.slug = ? AND books.status = 'published'
    `,
  )
    .bind(bookSlug, chapterSlug)
    .first<(ChapterSummary & { bookId: string }) | null>();

  if (!chapter) {
    return c.json(failure("not_found", `Chapter '${chapterSlug}' was not found.`), 404);
  }

  const [original, translationsResult] = await Promise.all([
    readObjectJson<OriginalChapterDocument>(c.env.CONTENT_BUCKET, chapter.sourceR2Key),
    c.env.DB.prepare(
      `
        SELECT
          id,
          slug,
          name,
          description,
          output_r2_prefix AS outputR2Prefix,
          status
        FROM translations
        WHERE book_id = ? AND status = 'published'
        ORDER BY name ASC
      `,
    )
      .bind(chapter.bookId)
      .all<TranslationSummary>(),
  ]);

  if (!original) {
    return c.json(failure("not_found", "Original chapter content was not found."), 404);
  }

  const payload: ChapterPayload = {
    chapter,
    original,
    availableTranslations: translationsResult.results ?? [],
  };

  return c.json(success(payload));
});

app.get("/api/books/:bookSlug/chapters/:chapterSlug/translations/:translationSlug", async (c) => {
  const { bookSlug, chapterSlug, translationSlug } = c.req.param();
  const translation = await c.env.DB.prepare(
    `
      SELECT
        translations.id,
        translations.slug,
        translations.name,
        translations.description,
        translations.output_r2_prefix AS outputR2Prefix,
        translations.status
      FROM translations
      JOIN books ON books.id = translations.book_id
      WHERE books.slug = ? AND translations.slug = ? AND translations.status = 'published'
    `,
  )
    .bind(bookSlug, translationSlug)
    .first<TranslationSummary>();

  if (!translation) {
    return c.json(failure("not_found", `Translation '${translationSlug}' was not found.`), 404);
  }

  const content = await readObjectJson<TranslationChapterDocument>(
    c.env.CONTENT_BUCKET,
    buildTranslationChapterKey(bookSlug, chapterSlug, translationSlug),
  );

  if (!content) {
    return c.json(failure("not_found", "Translated chapter content was not found."), 404);
  }

  const payload: TranslationPayload = {
    translation,
    content,
  };

  return c.json(success(payload));
});

app.get("/api/admin/settings", async (c) => c.json(success({ settings: await getSettingsMap(c.env.DB) })));

app.put("/api/admin/settings", async (c) => {
  const body = await c.req.json<{ settings: Record<string, string> }>();
  if (!body.settings || typeof body.settings !== "object") {
    return c.json(failure("bad_request", "Body must contain a `settings` object."), 400);
  }

  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(body.settings)) {
    await c.env.DB.prepare(
      `
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `,
    )
      .bind(key, value, now)
      .run();
  }

  return c.json(success({ updated: Object.keys(body.settings) }));
});

app.get("/api/admin/books", async (c) => {
  const results = await c.env.DB.prepare(
    `
      SELECT
        id,
        slug,
        title,
        author,
        original_language AS originalLanguage,
        description,
        cover_image_url AS coverImageUrl,
        status,
        published_at AS publishedAt
      FROM books
      ORDER BY created_at DESC
    `,
  ).all<BookSummary>();

  return c.json(success({ books: results.results ?? [] }));
});

app.get("/api/admin/books/:bookSlug", async (c) => {
  const bookSlug = c.req.param("bookSlug");
  const book = await c.env.DB.prepare(
    `
      SELECT
        id,
        slug,
        title,
        author,
        original_language AS originalLanguage,
        description,
        cover_image_url AS coverImageUrl,
        status,
        published_at AS publishedAt
      FROM books
      WHERE slug = ?
    `,
  )
    .bind(bookSlug)
    .first<BookSummary>();

  if (!book) {
    return c.json(failure("not_found", `Book '${bookSlug}' was not found.`), 404);
  }

  const [chaptersResult, translationsResult] = await Promise.all([
    c.env.DB.prepare(
      `
        SELECT
          id,
          slug,
          position,
          title,
          is_preview AS isPreview,
          source_r2_key AS sourceR2Key,
          status,
          published_at AS publishedAt
        FROM chapters
        WHERE book_id = ?
        ORDER BY position ASC
      `,
    )
      .bind(book.id)
      .all<ChapterSummary>(),
    c.env.DB.prepare(
      `
        SELECT
          id,
          slug,
          name,
          description,
          output_r2_prefix AS outputR2Prefix,
          status
        FROM translations
        WHERE book_id = ?
        ORDER BY name ASC
      `,
    )
      .bind(book.id)
      .all<TranslationSummary>(),
  ]);

  const payload: BookDetail = {
    ...book,
    chapters: chaptersResult.results ?? [],
    translations: translationsResult.results ?? [],
  };

  return c.json(success(payload));
});

app.post("/api/admin/books", async (c) => {
  try {
    const body = await c.req.json<{
      title?: string;
      slug?: string;
      author?: string;
      originalLanguage?: string;
      description?: string;
      chapters?: AdminBookChapterInput[];
    }>();

    if (!body.title?.trim()) {
      return c.json(failure("bad_request", "A book title is required."), 400);
    }

    const normalizedChapters = (body.chapters ?? [])
      .filter((chapter) => chapter.sourceText.trim().length > 0)
      .map((chapter, index) => ({
        position: index + 1,
        title: chapter.title.trim() || `Chapter ${index + 1}`,
        slug: slugify(chapter.slug || chapter.title || `chapter-${index + 1}`),
        sourceText: chapter.sourceText.trim(),
      }));

    if (normalizedChapters.length === 0) {
      return c.json(failure("bad_request", "At least one chapter is required."), 400);
    }

    const bookId = crypto.randomUUID();
    const bookSlug = slugify(body.slug || body.title);
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `
        INSERT INTO books (
          id, slug, title, author, original_language, description, cover_image_url,
          status, created_at, updated_at, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'draft', ?, ?, NULL)
      `,
    )
      .bind(
        bookId,
        bookSlug,
        body.title.trim(),
        body.author?.trim() || null,
        body.originalLanguage?.trim() || null,
        body.description?.trim() || null,
        now,
        now,
      )
      .run();

    for (const chapter of normalizedChapters) {
      const sourceR2Key = buildOriginalChapterKey(bookSlug, chapter.slug);
      const originalDocument = buildInitialOriginalDocument(bookSlug, chapter.slug, chapter.sourceText);
      await writeObjectJson(c.env.CONTENT_BUCKET, sourceR2Key, originalDocument);

      await c.env.DB.prepare(
        `
          INSERT INTO chapters (
            id, book_id, slug, position, title, is_preview, source_r2_key, status, created_at, updated_at, published_at
          ) VALUES (?, ?, ?, ?, ?, 0, ?, 'draft', ?, ?, NULL)
        `,
      )
        .bind(crypto.randomUUID(), bookId, chapter.slug, chapter.position, chapter.title, sourceR2Key, now, now)
        .run();
    }

    const payload = await getAdminBookSourcePayload(c.env.DB, c.env.CONTENT_BUCKET, bookSlug);
    if (!payload) {
      return c.json(failure("internal_error", "Book was created but could not be reloaded."), 500);
    }

    return c.json(success(payload), 201);
  } catch (error) {
    return c.json(failure("bad_request", error instanceof Error ? error.message : "Failed to create book."), 400);
  }
});

app.get("/api/admin/books/:bookSlug/source", async (c) => {
  const payload = await getAdminBookSourcePayload(c.env.DB, c.env.CONTENT_BUCKET, c.req.param("bookSlug"));
  if (!payload) {
    return c.json(failure("not_found", "Book was not found."), 404);
  }
  return c.json(success(payload));
});

app.get("/api/admin/books/:bookSlug/translations", async (c) =>
  c.json(success({ translations: await listAdminTranslations(c.env.DB, c.req.param("bookSlug")) })),
);

app.post("/api/admin/books/:bookSlug/translations", async (c) => {
  try {
    const bookSlug = c.req.param("bookSlug");
    const body = await c.req.json<{
      title?: string;
      slug?: string;
      description?: string;
      provider?: AiProvider;
      model?: string;
      thinkingLevel?: ThinkingLevel | null;
      prompt?: string;
      contextBeforeChapterCount?: number;
      contextAfterChapterCount?: number;
    }>();

    if (!body.title?.trim() || !body.model?.trim() || !body.prompt?.trim()) {
      return c.json(failure("bad_request", "Title, model, and prompt are required."), 400);
    }

    const book = await c.env.DB.prepare(`SELECT id FROM books WHERE slug = ?`).bind(bookSlug).first<{ id: string }>();
    if (!book) {
      return c.json(failure("not_found", "Book was not found."), 404);
    }

    const translationId = crypto.randomUUID();
    const translationSlug = slugify(body.slug || body.title);
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `
        INSERT INTO translations (
          id, book_id, slug, name, description, ai_system_prompt, output_r2_prefix, status, created_at, updated_at, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, NULL)
      `,
    )
      .bind(
        translationId,
        book.id,
        translationSlug,
        body.title.trim(),
        body.description?.trim() || null,
        body.prompt.trim(),
        `epics/${bookSlug}/translations/${translationSlug}`,
        now,
        now,
      )
      .run();

    await createAdminIngestionSessionForBook({
      db: c.env.DB,
      bucket: c.env.CONTENT_BUCKET,
      bookSlug,
      title: body.title.trim(),
      provider: normalizeProvider(body.provider),
      model: body.model.trim(),
      thinkingLevel: normalizeThinkingLevel(body.thinkingLevel),
      prompt: body.prompt.trim(),
      translationId,
      contextBeforeChapterCount: body.contextBeforeChapterCount ?? 1,
      contextAfterChapterCount: body.contextAfterChapterCount ?? 1,
    });

    const translation = await getAdminTranslationDetail(c.env.DB, translationId);
    if (!translation) {
      return c.json(failure("internal_error", "Translation was created but could not be reloaded."), 500);
    }

    return c.json(success(translation), 201);
  } catch (error) {
    return c.json(
      failure("bad_request", error instanceof Error ? error.message : "Failed to create translation."),
      400,
    );
  }
});

app.get("/api/admin/translations/:translationId", async (c) => {
  const translation = await getAdminTranslationDetail(c.env.DB, c.req.param("translationId"));
  if (!translation) {
    return c.json(failure("not_found", "Translation was not found."), 404);
  }
  return c.json(success(translation));
});

app.put("/api/admin/translations/:translationId", async (c) => {
  const translationId = c.req.param("translationId");
  const body = await c.req.json<{
    name?: string;
    slug?: string;
    description?: string;
    status?: TranslationSummary["status"];
    provider?: AiProvider;
    model?: string;
    thinkingLevel?: ThinkingLevel | null;
    prompt?: string;
    contextBeforeChapterCount?: number;
    contextAfterChapterCount?: number;
    currentChapterIndex?: number;
  }>();

  const existing = await getAdminTranslationDetail(c.env.DB, translationId);
  if (!existing) {
    return c.json(failure("not_found", "Translation was not found."), 404);
  }

  const now = new Date().toISOString();
  const nextSlug = slugify(body.slug || existing.slug);
  const nextName = body.name?.trim() || existing.name;
  const nextDescription = typeof body.description === "string" ? body.description.trim() || null : existing.description;
  const nextStatus =
    body.status && ["draft", "generating", "ready", "published", "failed"].includes(body.status)
      ? body.status
      : existing.status;
  const nextPrompt = body.prompt?.trim() || existing.aiSystemPrompt || "";
  const nextProvider =
    body.provider !== undefined
      ? normalizeProvider(body.provider)
      : (existing.currentSession?.provider ?? existing.latestSession?.provider ?? "google");
  const nextModel = body.model?.trim() || existing.latestSession?.model || "gemini-3-flash-preview";
  const nextThinkingLevel =
    body.thinkingLevel !== undefined
      ? normalizeThinkingLevel(body.thinkingLevel)
      : (existing.currentSession?.thinkingLevel ?? existing.latestSession?.thinkingLevel ?? null);
  const nextContextBeforeChapterCount =
    typeof body.contextBeforeChapterCount === "number" && body.contextBeforeChapterCount >= 0
      ? body.contextBeforeChapterCount
      : (existing.latestSession?.contextBeforeChapterCount ?? 1);
  const nextContextAfterChapterCount =
    typeof body.contextAfterChapterCount === "number" && body.contextAfterChapterCount >= 0
      ? body.contextAfterChapterCount
      : (existing.latestSession?.contextAfterChapterCount ?? 1);
  const nextCurrentChapterIndex =
    typeof body.currentChapterIndex === "number" && body.currentChapterIndex >= 0
      ? body.currentChapterIndex
      : (existing.currentSession?.currentChapterIndex ?? existing.latestSession?.currentChapterIndex ?? 0);

  await c.env.DB.prepare(
    `
      UPDATE translations
      SET slug = ?, name = ?, description = ?, ai_system_prompt = ?, output_r2_prefix = ?, status = ?, updated_at = ?
      WHERE id = ?
    `,
  )
    .bind(
      nextSlug,
      nextName,
      nextDescription,
      nextPrompt || null,
      `epics/${existing.bookSlug}/translations/${nextSlug}`,
      nextStatus,
      now,
      translationId,
    )
    .run();

  if (existing.currentSession) {
    await c.env.DB.prepare(
      `
        UPDATE admin_ingestion_sessions
        SET title = ?, provider = ?, model = ?, thinking_level = ?, prompt = ?, context_before_chapter_count = ?, context_after_chapter_count = ?, current_chapter_index = ?, updated_at = ?
        WHERE id = ?
      `,
    )
      .bind(
        nextName,
        nextProvider,
        nextModel,
        nextThinkingLevel,
        nextPrompt,
        nextContextBeforeChapterCount,
        nextContextAfterChapterCount,
        nextCurrentChapterIndex,
        now,
        existing.currentSession.id,
      )
      .run();
  }

  const updated = await getAdminTranslationDetail(c.env.DB, translationId);
  if (!updated) {
    return c.json(failure("internal_error", "Translation was updated but could not be reloaded."), 500);
  }
  return c.json(success(updated));
});

app.get("/api/admin/translations/:translationId/validate", async (c) => {
  const payload = await validateTranslation(c.env.DB, c.req.param("translationId"));
  if (!payload) {
    return c.json(failure("not_found", "Translation was not found."), 404);
  }
  return c.json(success(payload));
});

app.get("/api/admin/ingestion/bootstrap", async (c) => {
  const [books, settings, sessions] = await Promise.all([
    listAdminBookWorkflowSummaries(c.env.DB),
    getSettingsMap(c.env.DB),
    listAdminIngestionSessions(c.env.DB),
  ]);

  const payload: AdminIngestionBootstrapPayload = { books, settings, sessions };
  return c.json(success(payload));
});

app.post("/api/admin/ingestion/sessions", async (c) => {
  try {
    const body = await c.req.json<{
      title?: string;
      sourceMode?: AdminIngestionSourceMode;
      sourceBookSlug?: string;
      translationId?: string;
      provider?: AiProvider;
      model?: string;
      thinkingLevel?: ThinkingLevel | null;
      prompt?: string;
      contextBeforeChapterCount?: number;
      contextAfterChapterCount?: number;
      chapters?: AdminIngestionChapterInput[];
    }>();

    if (!body.title?.trim() || !body.model?.trim() || !body.prompt?.trim()) {
      return c.json(failure("bad_request", "Title, model, and prompt are required."), 400);
    }

    if (body.sourceMode !== "paste" && body.sourceMode !== "existing_story") {
      return c.json(failure("bad_request", "sourceMode must be 'paste' or 'existing_story'."), 400);
    }

    const chapters =
      body.sourceMode === "existing_story"
        ? await buildChapterInputsFromExistingStory(c.env.DB, c.env.CONTENT_BUCKET, body.sourceBookSlug)
        : normalizePastedChapterInputs(body.chapters ?? []);

    if (chapters.length === 0) {
      return c.json(failure("bad_request", "At least one chapter is required to create a session."), 400);
    }

    const now = new Date().toISOString();
    const sessionId = crypto.randomUUID();

    await c.env.DB.prepare(
      `
        INSERT INTO admin_ingestion_sessions (
          id, title, source_mode, source_book_slug, translation_id, provider, model, thinking_level, prompt,
          context_before_chapter_count, context_after_chapter_count, current_chapter_index, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
      .bind(
        sessionId,
        body.title.trim(),
        body.sourceMode,
        body.sourceBookSlug?.trim() || null,
        body.translationId?.trim() || null,
        normalizeProvider(body.provider),
        body.model.trim(),
        normalizeThinkingLevel(body.thinkingLevel),
        body.prompt.trim(),
        Math.max(0, body.contextBeforeChapterCount ?? 1),
        Math.max(0, body.contextAfterChapterCount ?? 1),
        0,
        now,
        now,
      )
      .run();

    for (const chapter of chapters) {
      await c.env.DB.prepare(
        `
          INSERT INTO admin_ingestion_chapters (
            id, session_id, position, title, slug, source_text, source_chapter_slug, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        `,
      )
        .bind(
          crypto.randomUUID(),
          sessionId,
          chapter.position,
          chapter.title,
          chapter.slug,
          chapter.sourceText,
          chapter.sourceChapterSlug,
          now,
          now,
        )
        .run();
    }

    const detail = await getAdminIngestionSessionDetail(c.env.DB, sessionId);
    if (!detail) {
      return c.json(failure("internal_error", "Session was created but could not be reloaded."), 500);
    }

    return c.json(success(detail), 201);
  } catch (error) {
    return c.json(failure("bad_request", error instanceof Error ? error.message : "Failed to create session."), 400);
  }
});

app.get("/api/admin/ingestion/sessions/:sessionId", async (c) => {
  const detail = await getAdminIngestionSessionDetail(c.env.DB, c.req.param("sessionId"));
  if (!detail) {
    return c.json(failure("not_found", "Session was not found."), 404);
  }
  return c.json(success(detail));
});

app.put("/api/admin/ingestion/sessions/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json<{
    title?: string;
    provider?: AiProvider;
    model?: string;
    thinkingLevel?: ThinkingLevel | null;
    prompt?: string;
    contextBeforeChapterCount?: number;
    contextAfterChapterCount?: number;
    currentChapterIndex?: number;
  }>();

  const existing = await getAdminIngestionSessionRow(c.env.DB, sessionId);
  if (!existing) {
    return c.json(failure("not_found", "Session was not found."), 404);
  }

  const nextTitle = body.title?.trim() || existing.title;
  const nextProvider = body.provider !== undefined ? normalizeProvider(body.provider) : existing.provider;
  const nextModel = body.model?.trim() || existing.model;
  const nextThinkingLevel =
    body.thinkingLevel !== undefined ? normalizeThinkingLevel(body.thinkingLevel) : existing.thinkingLevel;
  const nextPrompt = body.prompt?.trim() || existing.prompt;
  const nextContextBeforeChapterCount =
    typeof body.contextBeforeChapterCount === "number" && body.contextBeforeChapterCount >= 0
      ? body.contextBeforeChapterCount
      : existing.contextBeforeChapterCount;
  const nextContextAfterChapterCount =
    typeof body.contextAfterChapterCount === "number" && body.contextAfterChapterCount >= 0
      ? body.contextAfterChapterCount
      : existing.contextAfterChapterCount;
  const nextCurrentChapterIndex =
    typeof body.currentChapterIndex === "number" && body.currentChapterIndex >= 0
      ? body.currentChapterIndex
      : existing.currentChapterIndex;

  await c.env.DB.prepare(
    `
      UPDATE admin_ingestion_sessions
      SET title = ?, provider = ?, model = ?, thinking_level = ?, prompt = ?, context_before_chapter_count = ?, context_after_chapter_count = ?, current_chapter_index = ?, updated_at = ?
      WHERE id = ?
    `,
  )
    .bind(
      nextTitle,
      nextProvider,
      nextModel,
      nextThinkingLevel,
      nextPrompt,
      nextContextBeforeChapterCount,
      nextContextAfterChapterCount,
      nextCurrentChapterIndex,
      new Date().toISOString(),
      sessionId,
    )
    .run();

  const detail = await getAdminIngestionSessionDetail(c.env.DB, sessionId);
  if (!detail) {
    return c.json(failure("internal_error", "Session was updated but could not be reloaded."), 500);
  }

  return c.json(success(detail));
});

app.post("/api/admin/ingestion/sessions/:sessionId/chapters/:position/generate", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const position = Number(c.req.param("position"));

    if (!Number.isInteger(position) || position < 0) {
      return c.json(failure("bad_request", "Chapter position is invalid."), 400);
    }

    const detail = await getAdminIngestionSessionDetail(c.env.DB, sessionId);
    if (!detail) {
      return c.json(failure("not_found", "Session was not found."), 404);
    }

    const chapter = detail.chapters.find((entry) => entry.position === position);
    if (!chapter) {
      return c.json(failure("not_found", "Chapter was not found."), 404);
    }

    const settings = await getSettingsMap(c.env.DB);
    const apiKey =
      detail.provider === "google"
        ? settings[APP_SETTING_KEYS.GOOGLE_API_KEY]?.trim()
        : settings[APP_SETTING_KEYS.OPENROUTER_API_KEY]?.trim();
    if (!apiKey) {
      return c.json(
        failure(
          "missing_api_key",
          detail.provider === "google"
            ? "Set google_api_key in admin settings before generating chapters."
            : "Set openrouter_api_key in admin settings before generating chapters.",
        ),
        400,
      );
    }

    const previousChapters = detail.chapters
      .filter((entry) => entry.position < position && entry.position >= position - detail.contextBeforeChapterCount)
      .sort((left, right) => left.position - right.position);
    const nextChapters = detail.chapters
      .filter((entry) => entry.position > position && entry.position <= position + detail.contextAfterChapterCount)
      .sort((left, right) => left.position - right.position);

    const rawResponse =
      detail.provider === "google"
        ? await generateChapterWithGoogle({
            apiKey,
            model: detail.model,
            thinkingLevel: detail.thinkingLevel,
            prompt: detail.prompt,
            session: detail,
            chapter,
            previousChapters,
            nextChapters,
          })
        : await generateChapterWithOpenRouter({
            apiKey,
            model: detail.model,
            thinkingLevel: detail.thinkingLevel,
            prompt: detail.prompt,
            session: detail,
            chapter,
            previousChapters,
            nextChapters,
            publicAppUrl: c.env.PUBLIC_APP_URL,
          });

    const updatedChapter = await persistGeneratedChapter({
      db: c.env.DB,
      bucket: c.env.CONTENT_BUCKET,
      session: detail,
      chapter,
      rawResponse,
      statusOnSuccess: "generated",
    });

    return c.json(success({ chapter: updatedChapter }));
  } catch (error) {
    return c.json(
      failure("generation_failed", error instanceof Error ? error.message : "Chapter generation failed."),
      500,
    );
  }
});

app.put("/api/admin/ingestion/sessions/:sessionId/chapters/:position/save", async (c) => {
  const sessionId = c.req.param("sessionId");
  const position = Number(c.req.param("position"));
  const body = await c.req.json<{ rawResponse?: string }>();

  if (!Number.isInteger(position) || position < 0) {
    return c.json(failure("bad_request", "Chapter position is invalid."), 400);
  }
  if (!body.rawResponse?.trim()) {
    return c.json(failure("bad_request", "rawResponse is required when saving a chapter."), 400);
  }

  const detail = await getAdminIngestionSessionDetail(c.env.DB, sessionId);
  if (!detail) {
    return c.json(failure("not_found", "Session was not found."), 404);
  }

  const chapter = detail.chapters.find((entry) => entry.position === position);
  if (!chapter) {
    return c.json(failure("not_found", "Chapter was not found."), 404);
  }

  const updatedChapter = await persistGeneratedChapter({
    db: c.env.DB,
    bucket: c.env.CONTENT_BUCKET,
    session: detail,
    chapter,
    rawResponse: body.rawResponse,
    statusOnSuccess: "saved",
  });

  await c.env.DB.prepare(`UPDATE admin_ingestion_sessions SET current_chapter_index = ?, updated_at = ? WHERE id = ?`)
    .bind(position + 1, new Date().toISOString(), sessionId)
    .run();

  return c.json(
    success({
      chapter: updatedChapter,
      session: await getAdminIngestionSessionDetail(c.env.DB, sessionId),
    }),
  );
});

app.notFound((c) => c.json(failure("not_found", "Route not found."), 404));

export default app;

function normalizeProvider(value: AiProvider | null | undefined): AiProvider {
  return value === "openrouter" ? "openrouter" : "google";
}
