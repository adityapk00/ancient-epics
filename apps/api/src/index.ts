import {
  APP_SETTING_KEYS,
  buildOriginalChapterKey,
  buildTranslationChapterKey,
  normalizeAccessLevel,
  normalizeProvider,
  normalizeThinkingLevel,
  slugify,
  type AdminBootstrapPayload,
  type AiProvider,
  type OriginalChapterDocument,
  type SourceChapterInput,
  type ThinkingLevel,
  type TranslationChapterDocument,
  type TranslationChapterDraft,
  type TranslationDraftArchive,
} from "@ancient-epics/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  authenticateUser,
  authenticateAdminPassword,
  buildAuthSessionPayload,
  createUserAccount,
  getCurrentAdminSession,
  getCurrentAuthUser,
  revokeCurrentAdminSession,
  revokeCurrentSession,
  setAdminSessionCookie,
  setAuthSessionCookie,
  validateEmailAndPassword,
  validatePasswordInput,
} from "./auth";
import {
  getAdminBookSourcePayload,
  getAdminTranslationDetail,
  getPublishedBookAccessLevel,
  getPublishedTranslationPayload,
  getPublishedTranslationSummary,
  getPublicBookDetail,
  getReaderChapterPayload,
  getSettingsMap,
  listAdminBookSummaries,
  listAdminTranslations,
  listBookChapters,
  listPublicBooks,
  upsertSettings,
  validateTranslationDetail,
} from "./data";
import { generateChapterWithGoogle } from "./google";
import { failure, type AppEnv, readObjectText, success, writeObjectJson, writeObjectText } from "./http";
import { generateChapterWithOpenRouter } from "./openrouter";
import { saveTranslationChapterDraft } from "./translation-generation";

const app = new Hono<AppEnv>();

app.use("/api/*", async (c, next) => {
  const origin = c.env.PUBLIC_APP_URL ?? "http://127.0.0.1:5173";
  return cors({
    origin,
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
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

app.get("/api/auth/session", async (c) => c.json(success(buildAuthSessionPayload(await getCurrentAuthUser(c)))));

app.post("/api/auth/signup", async (c) => {
  try {
    const body = await c.req.json<{ email?: string; password?: string }>();
    const credentials = validateEmailAndPassword(body);
    const { user, sessionToken } = await createUserAccount(c.env.DB, credentials);
    setAuthSessionCookie(c, sessionToken);
    return c.json(success(buildAuthSessionPayload(user)), 201);
  } catch (error) {
    return c.json(failure("bad_request", error instanceof Error ? error.message : "Failed to create account."), 400);
  }
});

app.post("/api/auth/login", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();

  try {
    const credentials = validateEmailAndPassword(body);
    const session = await authenticateUser(c.env.DB, credentials);

    if (!session) {
      return c.json(failure("invalid_credentials", "Incorrect email or password."), 401);
    }

    setAuthSessionCookie(c, session.sessionToken);
    return c.json(success(buildAuthSessionPayload(session.user)));
  } catch (error) {
    return c.json(failure("bad_request", error instanceof Error ? error.message : "Failed to log in."), 400);
  }
});

app.post("/api/auth/logout", async (c) => {
  await revokeCurrentSession(c);
  return c.json(success(buildAuthSessionPayload(null)));
});

app.get("/api/admin/session", async (c) => c.json(success({ authenticated: await getCurrentAdminSession(c) })));

app.post("/api/admin/login", async (c) => {
  const body = await c.req.json<{ password?: string }>();

  try {
    const password = validatePasswordInput(body.password);
    const session = await authenticateAdminPassword(c.env.DB, password);

    if (!session) {
      return c.json(failure("invalid_credentials", "Incorrect admin password."), 401);
    }

    setAdminSessionCookie(c, session.sessionToken);
    return c.json(success({ authenticated: true }));
  } catch (error) {
    return c.json(failure("bad_request", error instanceof Error ? error.message : "Failed to log in."), 400);
  }
});

app.post("/api/admin/logout", async (c) => {
  await revokeCurrentAdminSession(c);
  return c.json(success({ authenticated: false }));
});

app.get("/api/books", async (c) => c.json(success({ books: await listPublicBooks(c.env.DB) })));

app.get("/api/books/:bookSlug", async (c) => {
  const payload = await getPublicBookDetail(c.env.DB, c.req.param("bookSlug"));

  if (!payload) {
    return c.json(failure("not_found", "Book was not found."), 404);
  }

  return c.json(success(payload));
});

app.get("/api/books/:bookSlug/chapters/:chapterSlug", async (c) => {
  const translationSlug = c.req.query("translation") ?? null;

  if (translationSlug) {
    const translation = await getPublishedTranslationSummary(c.env.DB, {
      bookSlug: c.req.param("bookSlug"),
      translationSlug,
    });

    if (!translation) {
      return c.json(failure("not_found", "Translation was not found."), 404);
    }

    if (translation.accessLevel === "loggedin" && !(await getCurrentAuthUser(c))) {
      return c.json(failure("auth_required", "Sign up for free to read this translation."), 401);
    }
  } else {
    const bookAccessLevel = await getPublishedBookAccessLevel(c.env.DB, c.req.param("bookSlug"));

    if (!bookAccessLevel) {
      return c.json(failure("not_found", "Book was not found."), 404);
    }

    if (bookAccessLevel === "loggedin" && !(await getCurrentAuthUser(c))) {
      return c.json(failure("auth_required", "Sign up for free to unlock this book."), 401);
    }
  }

  const payload = await getReaderChapterPayload(c.env.DB, c.env.CONTENT_BUCKET, {
    bookSlug: c.req.param("bookSlug"),
    chapterSlug: c.req.param("chapterSlug"),
    translationSlug,
  });

  if (!payload) {
    return c.json(failure("not_found", "Chapter was not found."), 404);
  }

  return c.json(success(payload));
});

app.get("/api/books/:bookSlug/chapters/:chapterSlug/translations/:translationSlug", async (c) => {
  const translation = await getPublishedTranslationSummary(c.env.DB, {
    bookSlug: c.req.param("bookSlug"),
    translationSlug: c.req.param("translationSlug"),
  });

  if (!translation) {
    return c.json(failure("not_found", "Translation was not found."), 404);
  }

  if (translation.accessLevel === "loggedin" && !(await getCurrentAuthUser(c))) {
    return c.json(failure("auth_required", "Sign up for free to read this translation."), 401);
  }

  const payload = await getPublishedTranslationPayload(c.env.DB, c.env.CONTENT_BUCKET, {
    bookSlug: c.req.param("bookSlug"),
    chapterSlug: c.req.param("chapterSlug"),
    translationSlug: c.req.param("translationSlug"),
  });

  if (!payload) {
    return c.json(failure("not_found", "Translation was not found."), 404);
  }

  return c.json(success(payload));
});

app.use("/api/admin/*", async (c, next) => {
  if (!(await getCurrentAdminSession(c))) {
    return c.json(failure("admin_auth_required", "Admin login required."), 401);
  }

  return next();
});

app.get("/api/admin/settings", async (c) => c.json(success({ settings: await getSettingsMap(c.env.DB) })));

app.put("/api/admin/settings", async (c) => {
  const body = await c.req.json<{ settings?: Record<string, string> }>();

  if (!body.settings || typeof body.settings !== "object") {
    return c.json(failure("bad_request", "Body must contain a `settings` object."), 400);
  }

  await upsertSettings(c.env.DB, body.settings);
  return c.json(success({ updated: Object.keys(body.settings) }));
});

app.get("/api/admin/bootstrap", async (c) => {
  const [books, settings] = await Promise.all([listAdminBookSummaries(c.env.DB), getSettingsMap(c.env.DB)]);
  const payload: AdminBootstrapPayload = { books, settings };
  return c.json(success(payload));
});

app.get("/api/admin/books", async (c) => c.json(success({ books: await listAdminBookSummaries(c.env.DB) })));

app.get("/api/admin/books/:bookSlug", async (c) => {
  const payload = await getAdminBookSourcePayload(c.env.DB, c.env.CONTENT_BUCKET, c.req.param("bookSlug"));

  if (!payload) {
    return c.json(failure("not_found", "Book was not found."), 404);
  }

  return c.json(success(payload));
});

app.get("/api/admin/books/:bookSlug/source", async (c) => {
  const payload = await getAdminBookSourcePayload(c.env.DB, c.env.CONTENT_BUCKET, c.req.param("bookSlug"));

  if (!payload) {
    return c.json(failure("not_found", "Book was not found."), 404);
  }

  return c.json(success(payload));
});

app.post("/api/admin/books", async (c) => {
  try {
    const body = await c.req.json<{
      title?: string;
      author?: string;
      originalLanguage?: string;
      description?: string;
      chapters?: SourceChapterInput[];
    }>();

    if (!body.title?.trim()) {
      return c.json(failure("bad_request", "A book title is required."), 400);
    }

    const chapters = normalizeBookChapters(body.chapters ?? []);
    if (chapters.length === 0) {
      return c.json(failure("bad_request", "At least one chapter is required."), 400);
    }

    const bookId = crypto.randomUUID();
    const bookSlug = await createUniqueBookSlug(c.env.DB, body.title);
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `
          INSERT INTO books (
            id, slug, title, author, original_language, description, cover_image_url, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
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

    for (const chapter of chapters) {
      await writeObjectJson(
        c.env.CONTENT_BUCKET,
        buildOriginalChapterKey(bookSlug, chapter.slug),
        buildOriginalDocument(bookSlug, chapter.slug, chapter.sourceText),
      );

      await c.env.DB.prepare(
        `
            INSERT INTO chapters (id, book_id, slug, position, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
      )
        .bind(crypto.randomUUID(), bookId, chapter.slug, chapter.position, chapter.title, now, now)
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

app.put("/api/admin/books/:bookSlug", async (c) => {
  const existing = await getAdminBookSourcePayload(c.env.DB, c.env.CONTENT_BUCKET, c.req.param("bookSlug"));

  if (!existing) {
    return c.json(failure("not_found", "Book was not found."), 404);
  }

  const body = await c.req.json<{
    title?: string;
    author?: string;
    originalLanguage?: string;
    description?: string;
  }>();

  await c.env.DB.prepare(
    `
        UPDATE books
        SET title = ?, author = ?, original_language = ?, description = ?, updated_at = ?
        WHERE id = ?
      `,
  )
    .bind(
      body.title?.trim() || existing.book.title,
      typeof body.author === "string" ? body.author.trim() || null : existing.book.author,
      typeof body.originalLanguage === "string" ? body.originalLanguage.trim() || null : existing.book.originalLanguage,
      typeof body.description === "string" ? body.description.trim() || null : existing.book.description,
      new Date().toISOString(),
      existing.book.id,
    )
    .run();

  const payload = await getAdminBookSourcePayload(c.env.DB, c.env.CONTENT_BUCKET, existing.book.slug);
  if (!payload) {
    return c.json(failure("internal_error", "Book was updated but could not be reloaded."), 500);
  }

  return c.json(success(payload));
});

app.delete("/api/admin/books/:bookSlug", async (c) => {
  const bookSlug = c.req.param("bookSlug");
  const book = await c.env.DB.prepare(`SELECT id FROM books WHERE slug = ?`).bind(bookSlug).first<{ id: string }>();

  if (!book) {
    return c.json(failure("not_found", "Book was not found."), 404);
  }

  await deleteObjectsByPrefix(c.env.CONTENT_BUCKET, `epics/${bookSlug}/`);
  await c.env.DB.prepare(`DELETE FROM books WHERE id = ?`).bind(book.id).run();

  return c.json(success({ deleted: true, bookSlug }));
});

app.get("/api/admin/books/:bookSlug/translations", async (c) =>
  c.json(success({ translations: await listAdminTranslations(c.env.DB, c.req.param("bookSlug")) })),
);

app.post("/api/admin/books/:bookSlug/translations", async (c) => {
  try {
    const bookSlug = c.req.param("bookSlug");
    const body = await c.req.json<{
      title?: string;
      description?: string;
      accessLevel?: "public" | "loggedin";
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
    const translationSlug = await createUniqueTranslationSlug(c.env.DB, book.id, body.title);
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `
          INSERT INTO translations (
            id, book_id, slug, name, description, provider, model, thinking_level, prompt,
            context_before_chapter_count, context_after_chapter_count, access_level, status, published_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?)
        `,
    )
      .bind(
        translationId,
        book.id,
        translationSlug,
        body.title.trim(),
        body.description?.trim() || null,
        normalizeProvider(body.provider),
        body.model.trim(),
        normalizeThinkingLevel(body.thinkingLevel),
        body.prompt.trim(),
        Math.max(0, body.contextBeforeChapterCount ?? 1),
        Math.max(0, body.contextAfterChapterCount ?? 1),
        normalizeAccessLevel(body.accessLevel),
        now,
        now,
      )
      .run();

    await initializeTranslationChapters(c.env.DB, translationId, book.id);

    const translation = await getAdminTranslationDetail(c.env.DB, c.env.CONTENT_BUCKET, translationId);
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

app.post("/api/admin/books/:bookSlug/translations/import", async (c) => {
  try {
    const bookSlug = c.req.param("bookSlug");
    const body = await c.req.json<{ archive?: unknown; session?: unknown }>();
    const archive = normalizeImportedArchive(body.archive ?? body.session ?? body);

    const book = await c.env.DB.prepare(`SELECT id FROM books WHERE slug = ?`).bind(bookSlug).first<{ id: string }>();
    if (!book) {
      return c.json(failure("not_found", "Book was not found."), 404);
    }

    const translationId = crypto.randomUUID();
    const translationSlug = await createUniqueTranslationSlug(c.env.DB, book.id, archive.translation.name);
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `
          INSERT INTO translations (
            id, book_id, slug, name, description, provider, model, thinking_level, prompt,
            context_before_chapter_count, context_after_chapter_count, access_level, status, published_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?)
        `,
    )
      .bind(
        translationId,
        book.id,
        translationSlug,
        archive.translation.name,
        archive.translation.description,
        archive.translation.provider,
        archive.translation.model,
        archive.translation.thinkingLevel,
        archive.translation.prompt,
        archive.translation.contextBeforeChapterCount,
        archive.translation.contextAfterChapterCount,
        normalizeAccessLevel(archive.translation.accessLevel),
        now,
        now,
      )
      .run();

    await initializeTranslationChapters(c.env.DB, translationId, book.id);

    const translation = await getAdminTranslationDetail(c.env.DB, c.env.CONTENT_BUCKET, translationId);
    if (!translation) {
      return c.json(failure("internal_error", "Imported translation could not be reloaded."), 500);
    }

    const importedBySlug = new Map(archive.chapters.map((chapter) => [chapter.chapterSlug, chapter]));

    for (const chapter of translation.chapters) {
      const imported =
        importedBySlug.get(chapter.slug) ?? archive.chapters.find((entry) => entry.position === chapter.position);
      if (!imported) {
        continue;
      }

      const rawResponse =
        imported.rawResponse ?? buildRawResponseFromContent(imported.title, imported.notes, imported.content);
      if (!rawResponse) {
        continue;
      }

      await saveTranslationChapterDraft({
        db: c.env.DB,
        bucket: c.env.CONTENT_BUCKET,
        bookSlug: translation.bookSlug,
        translation,
        chapter,
        rawResponse,
        statusOnSuccess: imported.status === "saved" ? "saved" : "draft",
      });
    }

    const refreshed = await getAdminTranslationDetail(c.env.DB, c.env.CONTENT_BUCKET, translationId);
    if (!refreshed) {
      return c.json(failure("internal_error", "Imported translation could not be reloaded."), 500);
    }

    return c.json(success(refreshed), 201);
  } catch (error) {
    return c.json(
      failure("bad_request", error instanceof Error ? error.message : "Failed to import translation."),
      400,
    );
  }
});

app.get("/api/admin/translations/:translationId", async (c) => {
  const translation = await getAdminTranslationDetail(c.env.DB, c.env.CONTENT_BUCKET, c.req.param("translationId"));

  if (!translation) {
    return c.json(failure("not_found", "Translation was not found."), 404);
  }

  return c.json(success(translation));
});

app.put("/api/admin/translations/:translationId", async (c) => {
  const translationId = c.req.param("translationId");
  const existing = await getAdminTranslationDetail(c.env.DB, c.env.CONTENT_BUCKET, translationId);

  if (!existing) {
    return c.json(failure("not_found", "Translation was not found."), 404);
  }

  const body = await c.req.json<{
    name?: string;
    slug?: string;
    description?: string;
    accessLevel?: "public" | "loggedin";
    provider?: AiProvider;
    model?: string;
    thinkingLevel?: ThinkingLevel | null;
    prompt?: string;
    contextBeforeChapterCount?: number;
    contextAfterChapterCount?: number;
  }>();

  const nextName = body.name?.trim() || existing.name;
  const desiredSlug = body.slug?.trim() || nextName;
  const nextSlug =
    desiredSlug === existing.slug
      ? existing.slug
      : await createUniqueTranslationSlugForRename(c.env.DB, existing.id, existing.bookSlug, desiredSlug);
  const nextDescription = typeof body.description === "string" ? body.description.trim() || null : existing.description;
  const nextAccessLevel =
    body.accessLevel !== undefined ? normalizeAccessLevel(body.accessLevel) : existing.accessLevel;
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
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `
        UPDATE translations
        SET
          slug = ?,
          name = ?,
          description = ?,
          access_level = ?,
          provider = ?,
          model = ?,
          thinking_level = ?,
          prompt = ?,
          context_before_chapter_count = ?,
          context_after_chapter_count = ?,
          updated_at = ?
        WHERE id = ?
      `,
  )
    .bind(
      nextSlug,
      nextName,
      nextDescription,
      nextAccessLevel,
      nextProvider,
      nextModel,
      nextThinkingLevel,
      nextPrompt,
      nextContextBeforeChapterCount,
      nextContextAfterChapterCount,
      now,
      translationId,
    )
    .run();

  if (existing.slug !== nextSlug) {
    await moveTranslationObjectsToSlug(
      c.env.CONTENT_BUCKET,
      existing.bookSlug,
      existing.slug,
      nextSlug,
      existing.chapters,
    );
  }

  const updated = await getAdminTranslationDetail(c.env.DB, c.env.CONTENT_BUCKET, translationId);
  if (!updated) {
    return c.json(failure("internal_error", "Translation was updated but could not be reloaded."), 500);
  }

  return c.json(success(updated));
});

app.delete("/api/admin/translations/:translationId", async (c) => {
  const translation = await getAdminTranslationDetail(c.env.DB, c.env.CONTENT_BUCKET, c.req.param("translationId"));

  if (!translation) {
    return c.json(failure("not_found", "Translation was not found."), 404);
  }

  await deleteTranslationObjects(c.env.CONTENT_BUCKET, translation.bookSlug, translation.slug, translation.chapters);
  await c.env.DB.prepare(`DELETE FROM translations WHERE id = ?`).bind(translation.id).run();

  return c.json(success({ deleted: true, translationId: translation.id }));
});

app.get("/api/admin/translations/:translationId/validate", async (c) => {
  const translation = await getAdminTranslationDetail(c.env.DB, c.env.CONTENT_BUCKET, c.req.param("translationId"));

  if (!translation) {
    return c.json(failure("not_found", "Translation was not found."), 404);
  }

  return c.json(success(await validateTranslationDetail(translation)));
});

app.post("/api/admin/translations/:translationId/chapters/:chapterId/generate", async (c) => {
  try {
    const translation = await getAdminTranslationDetail(c.env.DB, c.env.CONTENT_BUCKET, c.req.param("translationId"));

    if (!translation) {
      return c.json(failure("not_found", "Translation was not found."), 404);
    }

    const chapter = translation.chapters.find((entry) => entry.chapterId === c.req.param("chapterId"));
    if (!chapter) {
      return c.json(failure("not_found", "Chapter was not found."), 404);
    }

    const settings = await getSettingsMap(c.env.DB);
    const apiKey =
      translation.provider === "google"
        ? settings[APP_SETTING_KEYS.GOOGLE_API_KEY]?.trim()
        : settings[APP_SETTING_KEYS.OPENROUTER_API_KEY]?.trim();

    if (!apiKey) {
      return c.json(
        failure(
          "missing_api_key",
          translation.provider === "google"
            ? "Set google_api_key in admin settings before generating chapters."
            : "Set openrouter_api_key in admin settings before generating chapters.",
        ),
        400,
      );
    }

    const previousChapters = translation.chapters
      .filter(
        (entry) =>
          entry.position < chapter.position &&
          entry.position >= chapter.position - translation.contextBeforeChapterCount,
      )
      .sort((left, right) => left.position - right.position);
    const nextChapters = translation.chapters
      .filter(
        (entry) =>
          entry.position > chapter.position &&
          entry.position <= chapter.position + translation.contextAfterChapterCount,
      )
      .sort((left, right) => left.position - right.position);

    const rawResponse =
      translation.provider === "google"
        ? await generateChapterWithGoogle({
            apiKey,
            model: translation.model,
            thinkingLevel: translation.thinkingLevel,
            prompt: translation.prompt,
            translation,
            chapter,
            previousChapters,
            nextChapters,
          })
        : await generateChapterWithOpenRouter({
            apiKey,
            model: translation.model,
            thinkingLevel: translation.thinkingLevel,
            prompt: translation.prompt,
            translation,
            chapter,
            previousChapters,
            nextChapters,
            publicAppUrl: c.env.PUBLIC_APP_URL,
          });

    await saveTranslationChapterDraft({
      db: c.env.DB,
      bucket: c.env.CONTENT_BUCKET,
      bookSlug: translation.bookSlug,
      translation,
      chapter,
      rawResponse,
      statusOnSuccess: "draft",
    });

    const updated = await getAdminTranslationDetail(c.env.DB, c.env.CONTENT_BUCKET, translation.id);
    if (!updated) {
      return c.json(failure("internal_error", "Generated chapter could not be reloaded."), 500);
    }

    return c.json(success(updated));
  } catch (error) {
    return c.json(
      failure("generation_failed", error instanceof Error ? error.message : "Chapter generation failed."),
      500,
    );
  }
});

app.put("/api/admin/translations/:translationId/chapters/:chapterId", async (c) => {
  const translation = await getAdminTranslationDetail(c.env.DB, c.env.CONTENT_BUCKET, c.req.param("translationId"));

  if (!translation) {
    return c.json(failure("not_found", "Translation was not found."), 404);
  }

  const chapter = translation.chapters.find((entry) => entry.chapterId === c.req.param("chapterId"));
  if (!chapter) {
    return c.json(failure("not_found", "Chapter was not found."), 404);
  }

  const body = await c.req.json<{ rawResponse?: string }>();
  if (!body.rawResponse?.trim()) {
    return c.json(failure("bad_request", "rawResponse is required when saving a chapter."), 400);
  }

  await saveTranslationChapterDraft({
    db: c.env.DB,
    bucket: c.env.CONTENT_BUCKET,
    bookSlug: translation.bookSlug,
    translation,
    chapter,
    rawResponse: body.rawResponse,
    statusOnSuccess: "saved",
  });

  const updated = await getAdminTranslationDetail(c.env.DB, c.env.CONTENT_BUCKET, translation.id);
  if (!updated) {
    return c.json(failure("internal_error", "Saved chapter could not be reloaded."), 500);
  }

  return c.json(success(updated));
});

app.post("/api/admin/translations/:translationId/publish", async (c) => {
  const translation = await getAdminTranslationDetail(c.env.DB, c.env.CONTENT_BUCKET, c.req.param("translationId"));

  if (!translation) {
    return c.json(failure("not_found", "Translation was not found."), 404);
  }

  if (translation.chapters.length === 0) {
    return c.json(failure("bad_request", "A translation needs chapters before it can be published."), 400);
  }

  for (const chapter of translation.chapters) {
    const rawResponse =
      chapter.rawResponse ?? buildRawResponseFromContent(chapter.title, chapter.notes, chapter.content);

    if (!rawResponse) {
      return c.json(failure("bad_request", `Chapter '${chapter.title}' has no translation content to publish.`), 400);
    }

    if (chapter.status !== "saved") {
      await saveTranslationChapterDraft({
        db: c.env.DB,
        bucket: c.env.CONTENT_BUCKET,
        bookSlug: translation.bookSlug,
        translation,
        chapter,
        rawResponse,
        statusOnSuccess: "saved",
      });
    }
  }

  const ready = await getAdminTranslationDetail(c.env.DB, c.env.CONTENT_BUCKET, translation.id);
  if (!ready) {
    return c.json(failure("internal_error", "Translation could not be reloaded for publish."), 500);
  }

  const validation = await validateTranslationDetail(ready);
  if (!validation.isValid) {
    return c.json(failure("bad_request", "Fix validation errors before publishing."), 400);
  }

  await c.env.DB.prepare(
    `UPDATE translations SET status = 'published', published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?`,
  )
    .bind(new Date().toISOString(), new Date().toISOString(), ready.id)
    .run();

  const updated = await getAdminTranslationDetail(c.env.DB, c.env.CONTENT_BUCKET, ready.id);
  if (!updated) {
    return c.json(failure("internal_error", "Published translation could not be reloaded."), 500);
  }

  return c.json(success(updated));
});

app.post("/api/admin/translations/:translationId/unpublish", async (c) => {
  const translation = await getAdminTranslationDetail(c.env.DB, c.env.CONTENT_BUCKET, c.req.param("translationId"));

  if (!translation) {
    return c.json(failure("not_found", "Translation was not found."), 404);
  }

  await c.env.DB.prepare(`UPDATE translations SET status = 'draft', updated_at = ? WHERE id = ?`)
    .bind(new Date().toISOString(), translation.id)
    .run();

  const updated = await getAdminTranslationDetail(c.env.DB, c.env.CONTENT_BUCKET, translation.id);
  if (!updated) {
    return c.json(failure("internal_error", "Translation could not be reloaded."), 500);
  }

  return c.json(success(updated));
});

app.notFound((c) => c.json(failure("not_found", "Route not found."), 404));

export default app;

function buildOriginalDocument(bookSlug: string, chapterSlug: string, sourceText: string): OriginalChapterDocument {
  return {
    bookSlug,
    chapterSlug,
    fullText: sourceText.trim(),
  };
}

function normalizeBookChapters(chapters: SourceChapterInput[]): SourceChapterInput[] {
  return chapters
    .filter((chapter) => chapter.sourceText.trim().length > 0)
    .map((chapter, index) => ({
      position: index + 1,
      title: chapter.title.trim() || `Chapter ${index + 1}`,
      slug: slugify(chapter.slug || chapter.title || `chapter-${index + 1}`),
      sourceText: chapter.sourceText.trim(),
    }));
}

async function initializeTranslationChapters(db: D1Database, translationId: string, bookId: string): Promise<void> {
  const chapters = await listBookChapters(db, bookId);
  const now = new Date().toISOString();

  for (const chapter of chapters) {
    await db
      .prepare(
        `
          INSERT INTO translation_chapters (
            id, translation_id, chapter_id, status, error_message, created_at, updated_at
          ) VALUES (?, ?, ?, 'empty', NULL, ?, ?)
        `,
      )
      .bind(crypto.randomUUID(), translationId, chapter.id, now, now)
      .run();
  }
}

async function createUniqueBookSlug(db: D1Database, desiredName: string): Promise<string> {
  const baseSlug = slugify(desiredName);
  let candidate = baseSlug;
  let suffix = 2;

  for (;;) {
    const existing = await db.prepare(`SELECT 1 FROM books WHERE slug = ? LIMIT 1`).bind(candidate).first();
    if (!existing) {
      return candidate;
    }

    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
}

async function createUniqueTranslationSlug(db: D1Database, bookId: string, desiredName: string): Promise<string> {
  const baseSlug = slugify(desiredName);
  let candidate = baseSlug;
  let suffix = 2;

  for (;;) {
    const existing = await db
      .prepare(`SELECT 1 FROM translations WHERE book_id = ? AND slug = ? LIMIT 1`)
      .bind(bookId, candidate)
      .first();

    if (!existing) {
      return candidate;
    }

    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
}

async function createUniqueTranslationSlugForRename(
  db: D1Database,
  translationId: string,
  bookSlug: string,
  desiredName: string,
): Promise<string> {
  const book = await db.prepare(`SELECT id FROM books WHERE slug = ?`).bind(bookSlug).first<{ id: string }>();
  if (!book) {
    throw new Error("Book was not found for translation rename.");
  }

  const baseSlug = slugify(desiredName);
  let candidate = baseSlug;
  let suffix = 2;

  for (;;) {
    const existing = await db
      .prepare(`SELECT id FROM translations WHERE book_id = ? AND slug = ? LIMIT 1`)
      .bind(book.id, candidate)
      .first<{ id: string }>();

    if (!existing || existing.id === translationId) {
      return candidate;
    }

    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
}

async function deleteTranslationObjects(
  bucket: R2Bucket,
  bookSlug: string,
  translationSlug: string,
  chapters: Array<Pick<TranslationChapterDraft, "slug">>,
): Promise<void> {
  await deleteObjectsByKeys(
    bucket,
    chapters.map((chapter) => buildTranslationChapterKey(bookSlug, chapter.slug, translationSlug)),
  );
}

async function deleteObjectsByKeys(bucket: R2Bucket, keys: string[]): Promise<void> {
  const uniqueKeys = Array.from(new Set(keys.filter((key) => key.trim().length > 0)));
  if (uniqueKeys.length === 0) {
    return;
  }

  await bucket.delete(uniqueKeys);
}

async function moveTranslationObjectsToSlug(
  bucket: R2Bucket,
  bookSlug: string,
  previousSlug: string,
  nextSlug: string,
  chapters: Array<Pick<TranslationChapterDraft, "slug">>,
): Promise<void> {
  const previousKeysToDelete: string[] = [];

  for (const chapter of chapters) {
    const previousKey = buildTranslationChapterKey(bookSlug, chapter.slug, previousSlug);
    const nextKey = buildTranslationChapterKey(bookSlug, chapter.slug, nextSlug);
    const rawResponse = await readObjectText(bucket, previousKey);

    if (rawResponse === null) {
      continue;
    }

    await writeObjectText(bucket, nextKey, rawResponse);
    previousKeysToDelete.push(previousKey);
  }

  await deleteObjectsByKeys(bucket, previousKeysToDelete);
}

async function deleteObjectsByPrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;

  for (;;) {
    const listing = await bucket.list({ prefix, cursor });
    const keys = listing.objects.map((object) => object.key);

    if (keys.length > 0) {
      await bucket.delete(keys);
    }

    if (!listing.truncated || !listing.cursor) {
      break;
    }

    cursor = listing.cursor;
  }
}

function buildRawResponseFromContent(
  chapterTitle: string,
  notes: string | null,
  content: TranslationChapterDocument | null,
): string | null {
  if (!content || content.chunks.length === 0) {
    return null;
  }

  return JSON.stringify(
    {
      chapterTitle,
      notes: notes ?? "",
      chunks: content.chunks.map((chunk) => ({
        originalText: chunk.originalText,
        translatedText: chunk.translatedText,
        type: chunk.type,
      })),
    },
    null,
    2,
  );
}

function normalizeImportedArchive(input: unknown): TranslationDraftArchive {
  if (!input || typeof input !== "object") {
    throw new Error("A translation archive is required.");
  }

  const candidate = input as Record<string, unknown>;

  // Try parsing as the new TranslationDraftArchive format
  if (candidate.translation && typeof candidate.translation === "object" && Array.isArray(candidate.chapters)) {
    const archive = candidate as unknown as TranslationDraftArchive;
    return {
      ...archive,
      translation: {
        ...archive.translation,
        accessLevel: normalizeAccessLevel(archive.translation.accessLevel),
      },
    };
  }

  // Fallback for legacy "session-shaped" payloads (used by UI tests)
  const session = (
    candidate.session && typeof candidate.session === "object" ? candidate.session : candidate
  ) as Record<string, unknown>;

  if ((session.title || session.name) && Array.isArray(session.chapters)) {
    return {
      exportedAt: new Date().toISOString(),
      translation: {
        name: String(session.name ?? session.title),
        slug: slugify(String(session.name ?? session.title)),
        description: typeof session.description === "string" ? session.description : null,
        accessLevel: normalizeAccessLevel(session.accessLevel as "public" | "loggedin" | undefined),
        provider: normalizeProvider(session.provider as AiProvider | undefined),
        model: typeof session.model === "string" ? session.model : "gemini-3-flash-preview",
        thinkingLevel: normalizeThinkingLevel(session.thinkingLevel as ThinkingLevel | undefined),
        prompt: typeof session.prompt === "string" ? session.prompt : "",
        contextBeforeChapterCount:
          typeof session.contextBeforeChapterCount === "number" ? Math.max(0, session.contextBeforeChapterCount) : 1,
        contextAfterChapterCount:
          typeof session.contextAfterChapterCount === "number" ? Math.max(0, session.contextAfterChapterCount) : 1,
      },
      chapters: (session.chapters as Array<Record<string, unknown>>).map((chapter) => ({
        chapterSlug: String(chapter.chapterSlug ?? chapter.slug ?? ""),
        position: typeof chapter.position === "number" ? chapter.position : 0,
        title: typeof chapter.title === "string" ? chapter.title : "Chapter",
        status: mapImportedStatus(chapter.status),
        rawResponse: typeof chapter.rawResponse === "string" ? chapter.rawResponse : null,
        content:
          chapter.translationDocument && typeof chapter.translationDocument === "object"
            ? (chapter.translationDocument as TranslationChapterDocument)
            : null,
        notes: typeof chapter.notes === "string" ? chapter.notes : null,
      })),
    };
  }

  throw new Error("The selected file does not contain a valid translation archive.");
}

function mapImportedStatus(value: unknown): TranslationDraftArchive["chapters"][number]["status"] {
  switch (value) {
    case "saved":
      return "saved";
    case "generated":
    case "draft":
      return "draft";
    case "error":
      return "error";
    default:
      return "empty";
  }
}
