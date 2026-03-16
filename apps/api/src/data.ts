import {
  buildOriginalChapterKey,
  type AdminBookSourcePayload,
  type AdminBookSummary,
  type AdminTranslationDetail,
  type AdminTranslationSummary,
  type AdminTranslationValidationIssue,
  type AdminTranslationValidationPayload,
  type BookDetail,
  type BookSummary,
  type ChapterSummary,
  type OriginalChapterDocument,
  originalTextReconstructsSource,
  type ReaderChapterPayload,
  type SourceChapterInput,
  type TranslationChapterDocument,
  type TranslationChapterDraft,
  type TranslationPayload,
  type TranslationSummary,
} from "@ancient-epics/shared";
import { readObjectJson } from "./http";

type BookRow = {
  id: string;
  slug: string;
  title: string;
  author: string | null;
  originalLanguage: string | null;
  description: string | null;
  coverImageUrl: string | null;
  publishedAt: string | null;
  updatedAt?: string;
};

type ChapterRow = {
  id: string;
  bookId: string;
  slug: string;
  position: number;
  title: string;
};

type TranslationRow = {
  id: string;
  bookId: string;
  bookSlug: string;
  slug: string;
  name: string;
  description: string | null;
  provider: AdminTranslationSummary["provider"];
  model: string;
  thinkingLevel: AdminTranslationSummary["thinkingLevel"];
  prompt: string;
  contextBeforeChapterCount: number;
  contextAfterChapterCount: number;
  status: TranslationSummary["status"];
  publishedAt: string | null;
  updatedAt: string;
  latestActivityAt: string | null;
  chapterCount?: number;
  savedChapterCount?: number;
  draftChapterCount?: number;
  errorChapterCount?: number;
};

type TranslationChapterRow = {
  id: string;
  chapterId: string;
  slug: string;
  position: number;
  title: string;
  status: TranslationChapterDraft["status"];
  rawResponse: string | null;
  contentJson: string | null;
  notes: string | null;
  errorMessage: string | null;
  updatedAt: string;
};

type AppSettingRow = {
  key: string;
  value: string;
};

export async function getSettingsMap(db: D1Database): Promise<Record<string, string>> {
  const results = await db.prepare(`SELECT key, value FROM app_settings`).all<AppSettingRow>();
  return Object.fromEntries((results.results ?? []).map((entry) => [entry.key, entry.value]));
}

export async function upsertSettings(db: D1Database, settings: Record<string, string>): Promise<void> {
  const now = new Date().toISOString();

  for (const [key, value] of Object.entries(settings)) {
    await db
      .prepare(
        `
          INSERT INTO app_settings (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `,
      )
      .bind(key, value, now)
      .run();
  }
}

export async function listPublicBooks(db: D1Database): Promise<BookSummary[]> {
  const results = await db
    .prepare(
      `
        SELECT
          books.id,
          books.slug,
          books.title,
          books.author,
          books.original_language AS originalLanguage,
          books.description,
          books.cover_image_url AS coverImageUrl,
          MAX(translations.published_at) AS publishedAt
        FROM books
        JOIN translations
          ON translations.book_id = books.id
         AND translations.status = 'published'
        GROUP BY books.id
        ORDER BY publishedAt DESC, books.title ASC
      `,
    )
    .all<BookRow>();

  return (results.results ?? []).map(mapBookSummary);
}

export async function getPublicBookDetail(db: D1Database, bookSlug: string): Promise<BookDetail | null> {
  const book = await db
    .prepare(
      `
        SELECT
          books.id,
          books.slug,
          books.title,
          books.author,
          books.original_language AS originalLanguage,
          books.description,
          books.cover_image_url AS coverImageUrl,
          MAX(translations.published_at) AS publishedAt
        FROM books
        JOIN translations
          ON translations.book_id = books.id
         AND translations.status = 'published'
        WHERE books.slug = ?
        GROUP BY books.id
      `,
    )
    .bind(bookSlug)
    .first<BookRow>();

  if (!book) {
    return null;
  }

  const [chapters, translations] = await Promise.all([
    listBookChapters(db, book.id),
    listTranslationsForBook(db, book.id, true),
  ]);

  return {
    ...mapBookSummary(book),
    chapters,
    translations,
  };
}

export async function getReaderChapterPayload(
  db: D1Database,
  bucket: R2Bucket,
  input: {
    bookSlug: string;
    chapterSlug: string;
    translationSlug?: string | null;
  },
): Promise<ReaderChapterPayload | null> {
  const chapter = await db
    .prepare(
      `
        SELECT
          books.id AS bookId,
          books.slug AS bookSlug,
          books.title AS bookTitle,
          chapters.id,
          chapters.slug,
          chapters.position,
          chapters.title
        FROM books
        JOIN chapters
          ON chapters.book_id = books.id
        WHERE books.slug = ?
          AND chapters.slug = ?
          AND EXISTS (
            SELECT 1
            FROM translations
            WHERE translations.book_id = books.id
              AND translations.status = 'published'
          )
      `,
    )
    .bind(input.bookSlug, input.chapterSlug)
    .first<
      ChapterSummary & {
        bookId: string;
        bookSlug: string;
        bookTitle: string;
      }
    >();

  if (!chapter) {
    return null;
  }

  const [original, translations] = await Promise.all([
    readObjectJson<OriginalChapterDocument>(bucket, buildOriginalChapterKey(chapter.bookSlug, chapter.slug)),
    listTranslationsForBook(db, chapter.bookId, true),
  ]);

  if (!original) {
    return null;
  }

  let translation: TranslationPayload | null = null;

  if (input.translationSlug) {
    translation = await getPublishedTranslationPayload(db, bucket, {
      bookSlug: chapter.bookSlug,
      chapterSlug: chapter.slug,
      translationSlug: input.translationSlug,
    });
  }

  return {
    book: {
      slug: chapter.bookSlug,
      title: chapter.bookTitle,
    },
    chapter: {
      id: chapter.id,
      slug: chapter.slug,
      position: Number(chapter.position),
      title: chapter.title,
    },
    original,
    availableTranslations: translations,
    translation,
  };
}

export async function getPublishedTranslationPayload(
  db: D1Database,
  bucket: R2Bucket,
  input: {
    bookSlug: string;
    chapterSlug: string;
    translationSlug: string;
  },
): Promise<TranslationPayload | null> {
  const translation = await db
    .prepare(
      `
        SELECT
          translations.id,
          translations.slug,
          translations.name,
          translations.description,
          translations.status,
          translations.published_at AS publishedAt,
          translations.updated_at AS updatedAt
        FROM translations
        JOIN books
          ON books.id = translations.book_id
        WHERE books.slug = ?
          AND translations.slug = ?
          AND translations.status = 'published'
      `,
    )
    .bind(input.bookSlug, input.translationSlug)
    .first<TranslationSummary>();

  if (!translation) {
    return null;
  }

  const content = await readObjectJson<TranslationChapterDocument>(
    bucket,
    `epics/${input.bookSlug}/${input.chapterSlug}/translations/${input.translationSlug}.json`,
  );

  if (!content) {
    return null;
  }

  return { translation, content };
}

export async function listAdminBookSummaries(db: D1Database): Promise<AdminBookSummary[]> {
  const results = await db
    .prepare(
      `
        SELECT
          books.id,
          books.slug,
          books.title,
          books.author,
          books.original_language AS originalLanguage,
          books.description,
          books.cover_image_url AS coverImageUrl,
          MAX(translations.published_at) AS publishedAt,
          books.updated_at AS updatedAt,
          COUNT(DISTINCT chapters.id) AS chapterCount,
          COUNT(DISTINCT translations.id) AS translationCount,
          COUNT(DISTINCT CASE WHEN translations.status = 'published' THEN translations.id END) AS publishedTranslationCount,
          MAX(COALESCE(translation_chapters.updated_at, translations.updated_at, chapters.updated_at, books.updated_at)) AS latestActivityAt
        FROM books
        LEFT JOIN chapters
          ON chapters.book_id = books.id
        LEFT JOIN translations
          ON translations.book_id = books.id
        LEFT JOIN translation_chapters
          ON translation_chapters.translation_id = translations.id
        GROUP BY books.id
        ORDER BY latestActivityAt DESC, books.title ASC
      `,
    )
    .all<AdminBookSummary & { updatedAt: string }>();

  return (results.results ?? []).map((row) => ({
    ...mapBookSummary(row),
    chapterCount: Number(row.chapterCount ?? 0),
    translationCount: Number(row.translationCount ?? 0),
    publishedTranslationCount: Number(row.publishedTranslationCount ?? 0),
    latestActivityAt: row.latestActivityAt ?? row.updatedAt,
  }));
}

export async function getAdminBookSourcePayload(
  db: D1Database,
  bucket: R2Bucket,
  bookSlug: string,
): Promise<AdminBookSourcePayload | null> {
  const book = await db
    .prepare(
      `
        SELECT
          id,
          slug,
          title,
          author,
          original_language AS originalLanguage,
          description,
          cover_image_url AS coverImageUrl,
          (
            SELECT MAX(published_at)
            FROM translations
            WHERE translations.book_id = books.id
              AND translations.status = 'published'
          ) AS publishedAt
        FROM books
        WHERE slug = ?
      `,
    )
    .bind(bookSlug)
    .first<BookRow>();

  if (!book) {
    return null;
  }

  const [chapters, translations, sourceChapters] = await Promise.all([
    listBookChapters(db, book.id),
    listTranslationsForBook(db, book.id, false),
    listBookSourceChapters(db, bucket, book),
  ]);

  return {
    book: {
      ...mapBookSummary(book),
      chapters,
      translations,
    },
    chapters: sourceChapters,
  };
}

export async function listAdminTranslations(db: D1Database, bookSlug: string): Promise<AdminTranslationSummary[]> {
  const results = await db
    .prepare(
      `
        SELECT
          translations.id,
          translations.book_id AS bookId,
          books.slug AS bookSlug,
          translations.slug,
          translations.name,
          translations.description,
          translations.provider,
          translations.model,
          translations.thinking_level AS thinkingLevel,
          translations.prompt,
          translations.context_before_chapter_count AS contextBeforeChapterCount,
          translations.context_after_chapter_count AS contextAfterChapterCount,
          translations.status,
          translations.published_at AS publishedAt,
          translations.updated_at AS updatedAt,
          MAX(COALESCE(translation_chapters.updated_at, translations.updated_at)) AS latestActivityAt,
          COUNT(translation_chapters.id) AS chapterCount,
          COUNT(CASE WHEN translation_chapters.status = 'saved' THEN 1 END) AS savedChapterCount,
          COUNT(CASE WHEN translation_chapters.status = 'draft' THEN 1 END) AS draftChapterCount,
          COUNT(CASE WHEN translation_chapters.status = 'error' THEN 1 END) AS errorChapterCount
        FROM translations
        JOIN books
          ON books.id = translations.book_id
        LEFT JOIN translation_chapters
          ON translation_chapters.translation_id = translations.id
        WHERE books.slug = ?
        GROUP BY translations.id
        ORDER BY translations.name ASC
      `,
    )
    .bind(bookSlug)
    .all<TranslationRow>();

  return (results.results ?? []).map(mapAdminTranslationSummary);
}

export async function getAdminTranslationDetail(
  db: D1Database,
  bucket: R2Bucket,
  translationId: string,
): Promise<AdminTranslationDetail | null> {
  const translation = await db
    .prepare(
      `
        SELECT
          translations.id,
          translations.book_id AS bookId,
          books.slug AS bookSlug,
          translations.slug,
          translations.name,
          translations.description,
          translations.provider,
          translations.model,
          translations.thinking_level AS thinkingLevel,
          translations.prompt,
          translations.context_before_chapter_count AS contextBeforeChapterCount,
          translations.context_after_chapter_count AS contextAfterChapterCount,
          translations.status,
          translations.published_at AS publishedAt,
          translations.updated_at AS updatedAt,
          MAX(COALESCE(translation_chapters.updated_at, translations.updated_at)) AS latestActivityAt,
          COUNT(translation_chapters.id) AS chapterCount,
          COUNT(CASE WHEN translation_chapters.status = 'saved' THEN 1 END) AS savedChapterCount,
          COUNT(CASE WHEN translation_chapters.status = 'draft' THEN 1 END) AS draftChapterCount,
          COUNT(CASE WHEN translation_chapters.status = 'error' THEN 1 END) AS errorChapterCount
        FROM translations
        JOIN books
          ON books.id = translations.book_id
        LEFT JOIN translation_chapters
          ON translation_chapters.translation_id = translations.id
        WHERE translations.id = ?
        GROUP BY translations.id
      `,
    )
    .bind(translationId)
    .first<TranslationRow>();

  if (!translation) {
    return null;
  }

  const chapterResults = await db
    .prepare(
      `
        SELECT
          translation_chapters.id,
          translation_chapters.chapter_id AS chapterId,
          chapters.slug,
          chapters.position,
          chapters.title,
          translation_chapters.status,
          translation_chapters.raw_response AS rawResponse,
          translation_chapters.content_json AS contentJson,
          translation_chapters.notes,
          translation_chapters.error_message AS errorMessage,
          translation_chapters.updated_at AS updatedAt
        FROM translation_chapters
        JOIN chapters
          ON chapters.id = translation_chapters.chapter_id
        WHERE translation_chapters.translation_id = ?
        ORDER BY chapters.position ASC
      `,
    )
    .bind(translationId)
    .all<TranslationChapterRow>();

  const chapters = await Promise.all(
    (chapterResults.results ?? []).map((chapter) =>
      mapTranslationChapterDraft(bucket, translation.bookSlug, translation.slug, chapter),
    ),
  );

  return {
    ...mapAdminTranslationSummary(translation),
    prompt: translation.prompt,
    chapters,
  };
}

export async function validateTranslationDetail(
  translation: AdminTranslationDetail,
): Promise<AdminTranslationValidationPayload> {
  const chapters = translation.chapters.map((chapter) => {
    const issues: AdminTranslationValidationIssue[] = [];

    if (!chapter.content || chapter.content.chunks.length === 0) {
      issues.push({
        level: "error",
        message: "Translation content is missing.",
        chapterId: chapter.chapterId,
        chapterPosition: chapter.position,
        chapterSlug: chapter.slug,
      });
    }

    for (const chunk of chapter.content?.chunks ?? []) {
      if (!chunk.originalText.trim()) {
        issues.push({
          level: "error",
          message: `Chunk ${chunk.id} is missing original text.`,
          chapterId: chapter.chapterId,
          chapterPosition: chapter.position,
          chapterSlug: chapter.slug,
          translationChunkId: chunk.id,
        });
      }

      if (!chunk.translatedText.trim()) {
        issues.push({
          level: "error",
          message: `Chunk ${chunk.id} is missing translated text.`,
          chapterId: chapter.chapterId,
          chapterPosition: chapter.position,
          chapterSlug: chapter.slug,
          translationChunkId: chunk.id,
        });
      }
    }

    if (chapter.content && !originalTextReconstructsSource(chapter.sourceText, chapter.content.chunks)) {
      issues.push({
        level: "warning",
        message: "Chunk original text does not exactly reconstruct the chapter source text.",
        chapterId: chapter.chapterId,
        chapterPosition: chapter.position,
        chapterSlug: chapter.slug,
      });
    }

    if (chapter.status === "error") {
      issues.push({
        level: "error",
        message: chapter.errorMessage ?? "Chapter is currently in an error state.",
        chapterId: chapter.chapterId,
        chapterPosition: chapter.position,
        chapterSlug: chapter.slug,
      });
    } else if (chapter.status !== "saved") {
      issues.push({
        level: "warning",
        message: `Chapter is currently marked ${chapter.status}.`,
        chapterId: chapter.chapterId,
        chapterPosition: chapter.position,
        chapterSlug: chapter.slug,
      });
    }

    return {
      chapterId: chapter.chapterId,
      position: chapter.position,
      title: chapter.title,
      slug: chapter.slug,
      status: chapter.status,
      issues,
    };
  });

  const issues = chapters.flatMap((chapter) => chapter.issues);

  return {
    translationId: translation.id,
    isValid: issues.every((issue) => issue.level !== "error"),
    issues,
    chapters,
  };
}

export async function listBookSourceChapters(
  db: D1Database,
  bucket: R2Bucket,
  book: Pick<BookRow, "id" | "slug">,
): Promise<SourceChapterInput[]> {
  const chapters = await listBookChapters(db, book.id);

  return Promise.all(
    chapters.map(async (chapter) => {
      const original = await readObjectJson<OriginalChapterDocument>(bucket, buildOriginalChapterKey(book.slug, chapter.slug));
      return {
        position: chapter.position,
        title: chapter.title,
        slug: chapter.slug,
        sourceText: original?.fullText ?? "",
      };
    }),
  );
}

export async function listBookChapters(db: D1Database, bookId: string): Promise<ChapterSummary[]> {
  const results = await db
    .prepare(
      `
        SELECT
          id,
          book_id AS bookId,
          slug,
          position,
          title
        FROM chapters
        WHERE book_id = ?
        ORDER BY position ASC
      `,
    )
    .bind(bookId)
    .all<ChapterRow>();

  return (results.results ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    position: Number(row.position),
    title: row.title,
  }));
}

export async function listTranslationsForBook(
  db: D1Database,
  bookId: string,
  publishedOnly: boolean,
): Promise<TranslationSummary[]> {
  const results = await db
    .prepare(
      `
        SELECT
          id,
          slug,
          name,
          description,
          status,
          published_at AS publishedAt,
          updated_at AS updatedAt
        FROM translations
        WHERE book_id = ?
          AND (? = 0 OR status = 'published')
        ORDER BY name ASC
      `,
    )
    .bind(bookId, publishedOnly ? 1 : 0)
    .all<TranslationSummary>();

  return results.results ?? [];
}

async function mapTranslationChapterDraft(
  bucket: R2Bucket,
  bookSlug: string,
  translationSlug: string,
  chapter: TranslationChapterRow,
): Promise<TranslationChapterDraft> {
  const original = await readObjectJson<OriginalChapterDocument>(bucket, buildOriginalChapterKey(bookSlug, chapter.slug));
  const content = parseJsonOrNull<TranslationChapterDocument>(chapter.contentJson);

  return {
    id: chapter.id,
    chapterId: chapter.chapterId,
    slug: chapter.slug,
    position: Number(chapter.position),
    title: chapter.title,
    sourceText: original?.fullText ?? "",
    status: chapter.status,
    rawResponse: chapter.rawResponse,
    content: content
      ? {
          ...content,
          translationSlug,
        }
      : null,
    notes: chapter.notes,
    errorMessage: chapter.errorMessage,
    updatedAt: chapter.updatedAt,
  };
}

function mapBookSummary(row: BookRow): BookSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    author: row.author,
    originalLanguage: row.originalLanguage,
    description: row.description,
    coverImageUrl: row.coverImageUrl,
    publishedAt: row.publishedAt,
  };
}

function mapAdminTranslationSummary(row: TranslationRow): AdminTranslationSummary {
  return {
    id: row.id,
    bookSlug: row.bookSlug,
    slug: row.slug,
    name: row.name,
    description: row.description,
    provider: row.provider,
    model: row.model,
    thinkingLevel: row.thinkingLevel,
    contextBeforeChapterCount: Number(row.contextBeforeChapterCount ?? 1),
    contextAfterChapterCount: Number(row.contextAfterChapterCount ?? 1),
    status: row.status,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
    chapterCount: Number(row.chapterCount ?? 0),
    savedChapterCount: Number(row.savedChapterCount ?? 0),
    draftChapterCount: Number(row.draftChapterCount ?? 0),
    errorChapterCount: Number(row.errorChapterCount ?? 0),
    latestActivityAt: row.latestActivityAt ?? row.updatedAt,
  };
}

function parseJsonOrNull<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  return JSON.parse(value) as T;
}
