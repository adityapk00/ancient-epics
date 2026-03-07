import {
  buildOriginalChapterKey,
  buildTranslationChapterKey,
  type ApiFailure,
  type ApiSuccess,
  type AppSetting,
  type BookDetail,
  type BookSummary,
  type ChapterPayload,
  type ChapterSummary,
  type OriginalChapterDocument,
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

const app = new Hono<AppEnv>();

app.use("/api/*", async (c, next) => {
  const origin = c.env.PUBLIC_APP_URL ?? "http://127.0.0.1:5173";
  return cors({
    origin,
    allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })(c, next);
});

// ── Health ───────────────────────────────────────────────────

app.get("/api/health", (c) => {
  return c.json(
    success({
      environment: c.env.APP_ENV ?? "development",
      now: new Date().toISOString(),
    }),
  );
});

// ── Public reader routes ─────────────────────────────────────

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
    .first<ChapterSummary & { bookId: string }>();

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

// ── Admin: App Settings ──────────────────────────────────────

app.get("/api/admin/settings", async (c) => {
  const results = await c.env.DB.prepare(
    `SELECT key, value, updated_at AS updatedAt FROM app_settings`,
  ).all<AppSetting>();

  const settings: Record<string, string> = {};
  for (const row of results.results ?? []) {
    settings[row.key] = row.value;
  }

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

// ── Admin: Books (list all, including drafts) ────────────────

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

// ── Catch-all ────────────────────────────────────────────────

app.notFound((c) => {
  return c.json(failure("not_found", "Route not found."), 404);
});

export default app;

// ── Helpers ──────────────────────────────────────────────────

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

export { buildOriginalChapterKey, buildTranslationChapterKey };
