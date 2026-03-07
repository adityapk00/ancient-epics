import {
  buildOriginalChapterKey,
  buildTranslationChapterKey,
  type ApiFailure,
  type ApiSuccess,
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
    allowMethods: ["GET", "POST", "OPTIONS"],
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
        is_published AS isPublished,
        published_at AS publishedAt
      FROM books
      WHERE is_published = 1
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
        is_published AS isPublished,
        published_at AS publishedAt
      FROM books
      WHERE slug = ? AND is_published = 1
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
          status,
          is_published AS isPublished
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
        chapters.published_at AS publishedAt,
        books.id AS bookId
      FROM chapters
      INNER JOIN books ON books.id = chapters.book_id
      WHERE books.slug = ?
        AND chapters.slug = ?
        AND books.is_published = 1
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
          status,
          is_published AS isPublished
        FROM translations
        WHERE book_id = ?
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
        translations.status,
        translations.is_published AS isPublished
      FROM translations
      INNER JOIN books ON books.id = translations.book_id
      WHERE books.slug = ?
        AND translations.slug = ?
        AND books.is_published = 1
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

export { buildOriginalChapterKey, buildTranslationChapterKey };
