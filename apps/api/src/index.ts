import {
  APP_SETTING_KEYS,
  buildOriginalChapterKey,
  buildTranslationChapterKey,
  type AdminIngestionBootstrapPayload,
  type AdminIngestionChapterInput,
  type AdminIngestionChapterRecord,
  type AdminIngestionChapterStatus,
  type AdminIngestionSessionDetail,
  type AdminIngestionSessionSummary,
  type AdminIngestionSourceMode,
  type ApiFailure,
  type ApiSuccess,
  type AppSetting,
  type BookDetail,
  type BookSummary,
  type ChapterPayload,
  type ChapterSummary,
  type ChunkType,
  type OriginalChapterDocument,
  type TextChunk,
  type TranslationChapterDocument,
  type TranslationPayload,
  type TranslationSummary,
} from "@ancient-epics/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";

type AppEnv = {
  Bindings: {
    APP_ENV?: string;
    CONTENT_BUCKET: R2Bucket;
    DB: D1Database;
    PUBLIC_APP_URL?: string;
    SESSION_SECRET?: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
  };
};

type AdminBookChapterRow = ChapterSummary & { bookId: string };

type AdminIngestionSessionRow = {
  id: string;
  title: string;
  sourceMode: AdminIngestionSourceMode;
  sourceBookSlug: string | null;
  model: string;
  prompt: string;
  currentChapterIndex: number;
  createdAt: string;
  updatedAt: string;
  chapterCount?: number;
};

type AdminIngestionChapterRow = {
  id: string;
  sessionId: string;
  position: number;
  title: string;
  slug: string;
  sourceText: string;
  sourceChapterSlug: string | null;
  status: AdminIngestionChapterStatus;
  rawResponse: string | null;
  originalDocumentJson: string | null;
  translationDocumentJson: string | null;
  notes: string | null;
  errorMessage: string | null;
  updatedAt: string;
};

type OpenRouterChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

type ParsedAiChunk = {
  text: string;
  type?: ChunkType;
};

type ParsedAiTranslationChunk = ParsedAiChunk & {
  sourceOrdinals?: number[];
  sourceOriginalOrdinals?: number[];
};

type ParsedAiChapterPayload = {
  chapterTitle?: string;
  notes?: string;
  originalChunks: ParsedAiChunk[];
  translationChunks: ParsedAiTranslationChunk[];
};

const app = new Hono<AppEnv>();

app.use("/api/*", async (c, next) => {
  const origin = c.env.PUBLIC_APP_URL ?? "http://127.0.0.1:5173";
  return cors({
    origin,
    allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })(c, next);
});

app.get("/api/health", (c) => {
  return c.json(
    success({
      environment: c.env.APP_ENV ?? "development",
      now: new Date().toISOString(),
    }),
  );
});

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
    return c.json(
      failure("not_found", `Book '${bookSlug}' was not found.`),
      404,
    );
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
  const bookSlug = c.req.param("bookSlug");
  const chapterSlug = c.req.param("chapterSlug");
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
      INNER JOIN books ON books.id = chapters.book_id
      WHERE books.slug = ?
        AND chapters.slug = ?
        AND books.status = 'published'
    `,
  )
    .bind(bookSlug, chapterSlug)
    .first<AdminBookChapterRow>();

  if (!chapter) {
    return c.json(
      failure("not_found", `Chapter '${chapterSlug}' was not found.`),
      404,
    );
  }

  const [original, translationsResult] = await Promise.all([
    readObjectJson<OriginalChapterDocument>(
      c.env.CONTENT_BUCKET,
      chapter.sourceR2Key,
    ),
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
    return c.json(
      failure(
        "missing_content",
        `Original chapter asset '${chapter.sourceR2Key}' is missing from R2.`,
      ),
      500,
    );
  }

  const payload: ChapterPayload = {
    chapter,
    original,
    availableTranslations: translationsResult.results ?? [],
  };

  return c.json(success(payload));
});

app.get(
  "/api/books/:bookSlug/chapters/:chapterSlug/translations/:translationSlug",
  async (c) => {
    const bookSlug = c.req.param("bookSlug");
    const chapterSlug = c.req.param("chapterSlug");
    const translationSlug = c.req.param("translationSlug");

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
      INNER JOIN books ON books.id = translations.book_id
      WHERE books.slug = ?
        AND translations.slug = ?
        AND books.status = 'published'
    `,
    )
      .bind(bookSlug, translationSlug)
      .first<TranslationSummary>();

    if (!translation) {
      return c.json(
        failure("not_found", `Translation '${translationSlug}' was not found.`),
        404,
      );
    }

    const translationKey = buildTranslationChapterKey(
      bookSlug,
      chapterSlug,
      translationSlug,
    );
    const content = await readObjectJson<TranslationChapterDocument>(
      c.env.CONTENT_BUCKET,
      translationKey,
    );

    if (!content) {
      return c.json(
        failure(
          "missing_content",
          `Translation asset '${translationKey}' is missing from R2.`,
        ),
        500,
      );
    }

    const payload: TranslationPayload = {
      translation,
      content,
    };

    return c.json(success(payload));
  },
);

app.get("/api/admin/settings", async (c) => {
  const settings = await getSettingsMap(c.env.DB);
  return c.json(success({ settings }));
});

app.put("/api/admin/settings", async (c) => {
  const body = await c.req.json<{ settings: Record<string, string> }>();

  if (!body.settings || typeof body.settings !== "object") {
    return c.json(
      failure("bad_request", "Body must contain a `settings` object."),
      400,
    );
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
    return c.json(
      failure("not_found", `Book '${bookSlug}' was not found.`),
      404,
    );
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

app.get("/api/admin/ingestion/bootstrap", async (c) => {
  const [booksResult, settings, sessions] = await Promise.all([
    c.env.DB.prepare(
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
        ORDER BY title ASC
      `,
    ).all<BookSummary>(),
    getSettingsMap(c.env.DB),
    listAdminIngestionSessions(c.env.DB),
  ]);

  const payload: AdminIngestionBootstrapPayload = {
    books: booksResult.results ?? [],
    settings,
    sessions,
  };

  return c.json(success(payload));
});

app.post("/api/admin/ingestion/sessions", async (c) => {
  try {
    const body = await c.req.json<{
      title?: string;
      sourceMode?: AdminIngestionSourceMode;
      sourceBookSlug?: string;
      model?: string;
      prompt?: string;
      chapters?: AdminIngestionChapterInput[];
    }>();

    if (!body.title?.trim()) {
      return c.json(
        failure("bad_request", "A session title is required."),
        400,
      );
    }

    if (!body.model?.trim()) {
      return c.json(failure("bad_request", "A model is required."), 400);
    }

    if (!body.prompt?.trim()) {
      return c.json(failure("bad_request", "A prompt is required."), 400);
    }

    if (body.sourceMode !== "paste" && body.sourceMode !== "existing_story") {
      return c.json(
        failure(
          "bad_request",
          "sourceMode must be 'paste' or 'existing_story'.",
        ),
        400,
      );
    }

    const chapters =
      body.sourceMode === "existing_story"
        ? await buildChapterInputsFromExistingStory(
            c.env.DB,
            c.env.CONTENT_BUCKET,
            body.sourceBookSlug,
          )
        : normalizePastedChapterInputs(body.chapters ?? []);

    if (chapters.length === 0) {
      return c.json(
        failure(
          "bad_request",
          "At least one chapter is required to create a session.",
        ),
        400,
      );
    }

    const now = new Date().toISOString();
    const sessionId = crypto.randomUUID();

    await c.env.DB.prepare(
      `
        INSERT INTO admin_ingestion_sessions (
          id,
          title,
          source_mode,
          source_book_slug,
          model,
          prompt,
          current_chapter_index,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
      .bind(
        sessionId,
        body.title.trim(),
        body.sourceMode,
        body.sourceBookSlug?.trim() || null,
        body.model.trim(),
        body.prompt.trim(),
        0,
        now,
        now,
      )
      .run();

    for (const chapter of chapters) {
      await c.env.DB.prepare(
        `
          INSERT INTO admin_ingestion_chapters (
            id,
            session_id,
            position,
            title,
            slug,
            source_text,
            source_chapter_slug,
            status,
            created_at,
            updated_at
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
      return c.json(
        failure(
          "internal_error",
          "Session was created but could not be reloaded.",
        ),
        500,
      );
    }

    return c.json(success(detail), 201);
  } catch (error) {
    return c.json(
      failure(
        "bad_request",
        error instanceof Error ? error.message : "Failed to create session.",
      ),
      400,
    );
  }
});

app.get("/api/admin/ingestion/sessions/:sessionId", async (c) => {
  const detail = await getAdminIngestionSessionDetail(
    c.env.DB,
    c.req.param("sessionId"),
  );

  if (!detail) {
    return c.json(failure("not_found", "Session was not found."), 404);
  }

  return c.json(success(detail));
});

app.put("/api/admin/ingestion/sessions/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json<{
    title?: string;
    model?: string;
    prompt?: string;
    currentChapterIndex?: number;
  }>();

  const existing = await getAdminIngestionSessionRow(c.env.DB, sessionId);

  if (!existing) {
    return c.json(failure("not_found", "Session was not found."), 404);
  }

  const nextTitle = body.title?.trim() || existing.title;
  const nextModel = body.model?.trim() || existing.model;
  const nextPrompt = body.prompt?.trim() || existing.prompt;
  const nextCurrentChapterIndex =
    typeof body.currentChapterIndex === "number" && body.currentChapterIndex >= 0
      ? body.currentChapterIndex
      : existing.currentChapterIndex;

  await c.env.DB.prepare(
    `
      UPDATE admin_ingestion_sessions
      SET title = ?, model = ?, prompt = ?, current_chapter_index = ?, updated_at = ?
      WHERE id = ?
    `,
  )
    .bind(
      nextTitle,
      nextModel,
      nextPrompt,
      nextCurrentChapterIndex,
      new Date().toISOString(),
      sessionId,
    )
    .run();

  const detail = await getAdminIngestionSessionDetail(c.env.DB, sessionId);

  if (!detail) {
    return c.json(
      failure(
        "internal_error",
        "Session was updated but could not be reloaded.",
      ),
      500,
    );
  }

  return c.json(success(detail));
});

app.post(
  "/api/admin/ingestion/sessions/:sessionId/chapters/:position/generate",
  async (c) => {
    try {
      const sessionId = c.req.param("sessionId");
      const position = Number(c.req.param("position"));

      if (!Number.isInteger(position) || position < 0) {
        return c.json(
          failure("bad_request", "Chapter position is invalid."),
          400,
        );
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
      const apiKey = settings[APP_SETTING_KEYS.OPENROUTER_API_KEY]?.trim();

      if (!apiKey) {
        return c.json(
          failure(
            "missing_api_key",
            "Set openrouter_api_key in admin settings before generating chapters.",
          ),
          400,
        );
      }

      const previousChapter = detail.chapters.find(
        (entry) => entry.position === position - 1,
      );
      const nextChapter = detail.chapters.find(
        (entry) => entry.position === position + 1,
      );

      const rawResponse = await generateChapterWithOpenRouter({
        apiKey,
        model: detail.model,
        prompt: detail.prompt,
        session: detail,
        chapter,
        previousChapter,
        nextChapter,
        publicAppUrl: c.env.PUBLIC_APP_URL,
      });

      const updatedChapter = await persistGeneratedChapter({
        db: c.env.DB,
        session: detail,
        chapter,
        rawResponse,
        statusOnSuccess: "generated",
      });

      return c.json(success({ chapter: updatedChapter }));
    } catch (error) {
      return c.json(
        failure(
          "generation_failed",
          error instanceof Error ? error.message : "Chapter generation failed.",
        ),
        500,
      );
    }
  },
);

app.put(
  "/api/admin/ingestion/sessions/:sessionId/chapters/:position/save",
  async (c) => {
    const sessionId = c.req.param("sessionId");
    const position = Number(c.req.param("position"));
    const body = await c.req.json<{ rawResponse?: string }>();

    if (!Number.isInteger(position) || position < 0) {
      return c.json(failure("bad_request", "Chapter position is invalid."), 400);
    }

    if (!body.rawResponse?.trim()) {
      return c.json(
        failure("bad_request", "rawResponse is required when saving a chapter."),
        400,
      );
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
      session: detail,
      chapter,
      rawResponse: body.rawResponse,
      statusOnSuccess: "saved",
    });

    await c.env.DB.prepare(
      `
        UPDATE admin_ingestion_sessions
        SET current_chapter_index = ?, updated_at = ?
        WHERE id = ?
      `,
    )
      .bind(position + 1, new Date().toISOString(), sessionId)
      .run();

    const updatedSession = await getAdminIngestionSessionDetail(c.env.DB, sessionId);

    return c.json(
      success({
        chapter: updatedChapter,
        session: updatedSession,
      }),
    );
  },
);

app.notFound((c) => {
  return c.json(failure("not_found", "Route not found."), 404);
});

export default app;

function success<T>(data: T): ApiSuccess<T> {
  return {
    ok: true,
    data,
  };
}

function failure(code: string, message: string): ApiFailure {
  return {
    ok: false,
    error: {
      code,
      message,
    },
  };
}

async function readObjectJson<T>(
  bucket: R2Bucket,
  key: string,
): Promise<T | null> {
  const object = await bucket.get(key);

  if (!object) {
    return null;
  }

  return object.json<T>();
}

async function getSettingsMap(db: D1Database): Promise<Record<string, string>> {
  const results = await db.prepare(
    `SELECT key, value, updated_at AS updatedAt FROM app_settings`,
  ).all<AppSetting>();

  const settings: Record<string, string> = {};
  for (const row of results.results ?? []) {
    settings[row.key] = row.value;
  }

  return settings;
}

async function listAdminIngestionSessions(
  db: D1Database,
): Promise<AdminIngestionSessionSummary[]> {
  const results = await db.prepare(
    `
      SELECT
        sessions.id,
        sessions.title,
        sessions.source_mode AS sourceMode,
        sessions.source_book_slug AS sourceBookSlug,
        sessions.model,
        sessions.current_chapter_index AS currentChapterIndex,
        sessions.created_at AS createdAt,
        sessions.updated_at AS updatedAt,
        COUNT(chapters.id) AS chapterCount
      FROM admin_ingestion_sessions AS sessions
      LEFT JOIN admin_ingestion_chapters AS chapters
        ON chapters.session_id = sessions.id
      GROUP BY sessions.id
      ORDER BY sessions.updated_at DESC
    `,
  ).all<AdminIngestionSessionRow>();

  return (results.results ?? []).map(mapAdminIngestionSessionSummary);
}

async function getAdminIngestionSessionRow(
  db: D1Database,
  sessionId: string,
): Promise<AdminIngestionSessionRow | null> {
  return db
    .prepare(
      `
        SELECT
          id,
          title,
          source_mode AS sourceMode,
          source_book_slug AS sourceBookSlug,
          model,
          prompt,
          current_chapter_index AS currentChapterIndex,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM admin_ingestion_sessions
        WHERE id = ?
      `,
    )
    .bind(sessionId)
    .first<AdminIngestionSessionRow>();
}

async function getAdminIngestionSessionDetail(
  db: D1Database,
  sessionId: string,
): Promise<AdminIngestionSessionDetail | null> {
  const session = await getAdminIngestionSessionRow(db, sessionId);

  if (!session) {
    return null;
  }

  const chapterResults = await db.prepare(
    `
      SELECT
        id,
        session_id AS sessionId,
        position,
        title,
        slug,
        source_text AS sourceText,
        source_chapter_slug AS sourceChapterSlug,
        status,
        raw_response AS rawResponse,
        original_document_json AS originalDocumentJson,
        translation_document_json AS translationDocumentJson,
        notes,
        error_message AS errorMessage,
        updated_at AS updatedAt
      FROM admin_ingestion_chapters
      WHERE session_id = ?
      ORDER BY position ASC
    `,
  )
    .bind(sessionId)
    .all<AdminIngestionChapterRow>();

  const chapters = (chapterResults.results ?? []).map(
    mapAdminIngestionChapterRecord,
  );

  return {
    ...mapAdminIngestionSessionSummary({
      ...session,
      chapterCount: chapters.length,
    }),
    prompt: session.prompt,
    chapters,
  };
}

function mapAdminIngestionSessionSummary(
  row: AdminIngestionSessionRow,
): AdminIngestionSessionSummary {
  return {
    id: row.id,
    title: row.title,
    sourceMode: row.sourceMode,
    sourceBookSlug: row.sourceBookSlug,
    model: row.model,
    currentChapterIndex: Number(row.currentChapterIndex ?? 0),
    chapterCount: Number(row.chapterCount ?? 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapAdminIngestionChapterRecord(
  row: AdminIngestionChapterRow,
): AdminIngestionChapterRecord {
  return {
    id: row.id,
    position: Number(row.position),
    title: row.title,
    slug: row.slug,
    sourceText: row.sourceText,
    sourceChapterSlug: row.sourceChapterSlug,
    status: row.status,
    rawResponse: row.rawResponse,
    originalDocument: parseJsonOrNull<OriginalChapterDocument>(
      row.originalDocumentJson,
    ),
    translationDocument: parseJsonOrNull<TranslationChapterDocument>(
      row.translationDocumentJson,
    ),
    notes: row.notes,
    errorMessage: row.errorMessage,
    updatedAt: row.updatedAt,
  };
}

function parseJsonOrNull<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  return JSON.parse(value) as T;
}

function normalizePastedChapterInputs(
  chapters: AdminIngestionChapterInput[],
): AdminIngestionChapterInput[] {
  return chapters
    .filter((chapter) => chapter.sourceText.trim().length > 0)
    .map((chapter, index) => ({
      position: index,
      title: chapter.title.trim() || `Chapter ${index + 1}`,
      slug: slugify(chapter.slug || chapter.title || `chapter-${index + 1}`),
      sourceText: chapter.sourceText.trim(),
      sourceChapterSlug: chapter.sourceChapterSlug ?? null,
    }));
}

async function buildChapterInputsFromExistingStory(
  db: D1Database,
  bucket: R2Bucket,
  sourceBookSlug: string | undefined,
): Promise<AdminIngestionChapterInput[]> {
  if (!sourceBookSlug?.trim()) {
    throw new Error("sourceBookSlug is required when using existing_story mode.");
  }

  const book = await db
    .prepare(`SELECT id, slug FROM books WHERE slug = ?`)
    .bind(sourceBookSlug.trim())
    .first<{ id: string; slug: string }>();

  if (!book) {
    throw new Error(`Book '${sourceBookSlug}' was not found.`);
  }

  const chaptersResult = await db.prepare(
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
    .all<ChapterSummary>();

  const chapters = chaptersResult.results ?? [];
  const inputs: AdminIngestionChapterInput[] = [];

  for (const [index, chapter] of chapters.entries()) {
    const original = await readObjectJson<OriginalChapterDocument>(
      bucket,
      chapter.sourceR2Key,
    );

    if (!original) {
      throw new Error(
        `Original chapter asset '${chapter.sourceR2Key}' is missing from R2.`,
      );
    }

    inputs.push({
      position: index,
      title: chapter.title,
      slug: chapter.slug,
      sourceText: sourceDocumentToText(original),
      sourceChapterSlug: chapter.slug,
    });
  }

  return inputs;
}

function sourceDocumentToText(document: OriginalChapterDocument): string {
  const hasVerse = document.chunks.some((chunk) => chunk.type === "verse");
  const separator = hasVerse ? "\n" : "\n\n";
  return document.chunks.map((chunk) => chunk.text).join(separator).trim();
}

async function generateChapterWithOpenRouter(input: {
  apiKey: string;
  model: string;
  prompt: string;
  session: AdminIngestionSessionDetail;
  chapter: AdminIngestionChapterRecord;
  previousChapter?: AdminIngestionChapterRecord;
  nextChapter?: AdminIngestionChapterRecord;
  publicAppUrl?: string;
}): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": input.publicAppUrl ?? "http://127.0.0.1:5173",
      "X-Title": "Ancient Epics Admin",
    },
    body: JSON.stringify({
      model: input.model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: input.prompt,
        },
        {
          role: "user",
          content: buildGenerationUserPrompt(input),
        },
      ],
    }),
  });

  const payload = (await response.json()) as OpenRouterChatResponse;

  if (!response.ok) {
    throw new Error(
      payload.error?.message ||
        `OpenRouter request failed with status ${response.status}.`,
    );
  }

  const content = payload.choices?.[0]?.message?.content;

  if (typeof content === "string" && content.trim()) {
    return content;
  }

  if (Array.isArray(content)) {
    const merged = content
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("\n")
      .trim();

    if (merged) {
      return merged;
    }
  }

  throw new Error("OpenRouter returned an empty message payload.");
}

function buildGenerationUserPrompt(input: {
  session: AdminIngestionSessionDetail;
  chapter: AdminIngestionChapterRecord;
  previousChapter?: AdminIngestionChapterRecord;
  nextChapter?: AdminIngestionChapterRecord;
}): string {
  return [
    `Project: ${input.session.title}`,
    `Source mode: ${input.session.sourceMode}`,
    `Chapter title: ${input.chapter.title}`,
    "",
    "Return JSON only.",
    "Each originalChunks item must contain text and optional type.",
    "Each translationChunks item must contain text, optional type, and sourceOrdinals referencing the 1-based ordinal positions of originalChunks.",
    "You may merge multiple original chunks into one translation chunk.",
    "Do not include ids. The application assigns ids after review.",
    "",
    "Previous chapter context:",
    input.previousChapter?.sourceText || "(none)",
    "",
    "Target chapter source text:",
    input.chapter.sourceText,
    "",
    "Next chapter context:",
    input.nextChapter?.sourceText || "(none)",
  ].join("\n");
}

async function persistGeneratedChapter(input: {
  db: D1Database;
  session: AdminIngestionSessionDetail;
  chapter: AdminIngestionChapterRecord;
  rawResponse: string;
  statusOnSuccess: Extract<AdminIngestionChapterStatus, "generated" | "saved">;
}): Promise<AdminIngestionChapterRecord> {
  const now = new Date().toISOString();

  try {
    const normalized = normalizeGeneratedChapter({
      session: input.session,
      chapter: input.chapter,
      rawResponse: input.rawResponse,
    });

    await input.db.prepare(
      `
        UPDATE admin_ingestion_chapters
        SET status = ?,
            raw_response = ?,
            original_document_json = ?,
            translation_document_json = ?,
            notes = ?,
            error_message = NULL,
            updated_at = ?
        WHERE id = ?
      `,
    )
      .bind(
        input.statusOnSuccess,
        input.rawResponse,
        JSON.stringify(normalized.originalDocument),
        JSON.stringify(normalized.translationDocument),
        normalized.notes,
        now,
        input.chapter.id,
      )
      .run();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to parse AI response.";

    await input.db.prepare(
      `
        UPDATE admin_ingestion_chapters
        SET status = 'error',
            raw_response = ?,
            error_message = ?,
            updated_at = ?
        WHERE id = ?
      `,
    )
      .bind(input.rawResponse, message, now, input.chapter.id)
      .run();
  }

  const refreshed = await input.db
    .prepare(
      `
        SELECT
          id,
          session_id AS sessionId,
          position,
          title,
          slug,
          source_text AS sourceText,
          source_chapter_slug AS sourceChapterSlug,
          status,
          raw_response AS rawResponse,
          original_document_json AS originalDocumentJson,
          translation_document_json AS translationDocumentJson,
          notes,
          error_message AS errorMessage,
          updated_at AS updatedAt
        FROM admin_ingestion_chapters
        WHERE id = ?
      `,
    )
    .bind(input.chapter.id)
    .first<AdminIngestionChapterRow>();

  if (!refreshed) {
    throw new Error("Generated chapter could not be reloaded.");
  }

  return mapAdminIngestionChapterRecord(refreshed);
}

function normalizeGeneratedChapter(input: {
  session: AdminIngestionSessionDetail;
  chapter: AdminIngestionChapterRecord;
  rawResponse: string;
}): {
  originalDocument: OriginalChapterDocument;
  translationDocument: TranslationChapterDocument;
  notes: string | null;
} {
  const parsed = parseAiChapterPayload(input.rawResponse);

  if (parsed.originalChunks.length === 0) {
    throw new Error("AI response did not include any original chunks.");
  }

  if (parsed.translationChunks.length === 0) {
    throw new Error("AI response did not include any translation chunks.");
  }

  const originalChunks: TextChunk[] = parsed.originalChunks.map((chunk, index) => ({
    id: `c${index + 1}`,
    type: chunk.type ?? inferChunkType(chunk.text),
    text: chunk.text.trim(),
    ordinal: index + 1,
  }));

  const translationChunks = parsed.translationChunks.map((chunk, index) => {
    const ordinals = normalizeSourceOrdinals(
      chunk.sourceOrdinals ?? chunk.sourceOriginalOrdinals,
      originalChunks.length,
      index,
    );

    return {
      id: `t${index + 1}`,
      type: chunk.type ?? inferChunkType(chunk.text),
      text: chunk.text.trim(),
      ordinal: index + 1,
      sourceChunkIds: ordinals.map((ordinal) => `c${ordinal}`),
    };
  });

  return {
    originalDocument: {
      bookSlug: input.session.sourceBookSlug ?? slugify(input.session.title),
      chapterSlug: input.chapter.slug,
      chunks: originalChunks,
    },
    translationDocument: {
      translationSlug: `${slugify(input.session.title)}-draft`,
      chunks: translationChunks,
    },
    notes: parsed.notes?.trim() || null,
  };
}

function parseAiChapterPayload(rawResponse: string): ParsedAiChapterPayload {
  const jsonText = extractJsonObject(rawResponse);
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  const original = Array.isArray(parsed.originalChunks)
    ? parsed.originalChunks.map(normalizeAiChunk).filter(isPresent)
    : [];
  const translation = Array.isArray(parsed.translationChunks)
    ? parsed.translationChunks.map(normalizeAiTranslationChunk).filter(isPresent)
    : [];

  return {
    chapterTitle:
      typeof parsed.chapterTitle === "string" ? parsed.chapterTitle : undefined,
    notes: typeof parsed.notes === "string" ? parsed.notes : undefined,
    originalChunks: original,
    translationChunks: translation,
  };
}

function normalizeAiChunk(value: unknown): ParsedAiChunk | null {
  if (typeof value === "string" && value.trim()) {
    return { text: value.trim() };
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";

  if (!text) {
    return null;
  }

  return {
    text,
    type: normalizeChunkType(record.type),
  };
}

function normalizeAiTranslationChunk(
  value: unknown,
): ParsedAiTranslationChunk | null {
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && value.trim()) {
      return { text: value.trim() };
    }

    return null;
  }

  const record = value as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";

  if (!text) {
    return null;
  }

  return {
    text,
    type: normalizeChunkType(record.type),
    sourceOrdinals: normalizeNumberArray(record.sourceOrdinals),
    sourceOriginalOrdinals: normalizeNumberArray(record.sourceOriginalOrdinals),
  };
}

function normalizeChunkType(value: unknown): ChunkType | undefined {
  return value === "verse" || value === "prose" ? value : undefined;
}

function normalizeNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry > 0);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeSourceOrdinals(
  value: number[] | undefined,
  maxOrdinal: number,
  translationIndex: number,
): number[] {
  const normalized = [...new Set((value ?? []).filter((entry) => entry <= maxOrdinal))]
    .sort((left, right) => left - right);

  if (normalized.length > 0) {
    return normalized;
  }

  return [Math.min(translationIndex + 1, maxOrdinal)];
}

function inferChunkType(text: string): ChunkType {
  return text.includes("\n") ? "verse" : "prose";
}

function extractJsonObject(raw: string): string {
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (codeBlockMatch?.[1]) {
    return codeBlockMatch[1].trim();
  }

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("AI response does not contain a JSON object.");
  }

  return raw.slice(firstBrace, lastBrace + 1).trim();
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "untitled"
  );
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}

export { buildOriginalChapterKey, buildTranslationChapterKey };