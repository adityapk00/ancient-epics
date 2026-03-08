import {
  type AiProvider,
  type AdminBookChapterInput,
  type AdminBookSourcePayload,
  type AdminBookWorkflowSummary,
  type AdminIngestionChapterInput,
  type AdminIngestionChapterRecord,
  type AdminIngestionChapterStatus,
  type AdminIngestionSessionDetail,
  type AdminIngestionSessionSummary,
  type AdminIngestionSourceMode,
  type AdminTranslationDetail,
  type AdminTranslationSummary,
  type AdminTranslationValidationPayload,
  buildOriginalChapterKey,
  type BookDetail,
  type BookSummary,
  type ChapterSummary,
  type OriginalChapterDocument,
  type ThinkingLevel,
  type TranslationChapterDocument,
  type TranslationSummary,
} from "@ancient-epics/shared";
import { readObjectJson, slugify, writeObjectJson } from "./http";

type AdminBookChapterRow = ChapterSummary & { bookId: string };

type AdminIngestionSessionRow = {
  id: string;
  title: string;
  sourceMode: AdminIngestionSourceMode;
  sourceBookSlug: string | null;
  translationId: string | null;
  provider: AiProvider;
  model: string;
  thinkingLevel: ThinkingLevel | null;
  prompt: string;
  contextBeforeChapterCount: number;
  contextAfterChapterCount: number;
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

type AdminTranslationRow = {
  id: string;
  bookId: string;
  bookSlug: string;
  slug: string;
  name: string;
  description: string | null;
  aiSystemPrompt: string | null;
  outputR2Prefix: string;
  status: TranslationSummary["status"];
  createdAt: string;
  updatedAt: string;
  latestActivityAt: string | null;
  sessionCount?: number;
  chapterCount?: number;
  savedChapterCount?: number;
  generatedChapterCount?: number;
  pendingChapterCount?: number;
};

export async function getSettingsMap(db: D1Database): Promise<Record<string, string>> {
  const results = await db.prepare(`SELECT key, value FROM app_settings`).all<AppSetting>();
  return Object.fromEntries((results.results ?? []).map((entry) => [entry.key, entry.value]));
}

type AppSetting = {
  key: string;
  value: string;
};

export async function listAdminBookWorkflowSummaries(db: D1Database): Promise<AdminBookWorkflowSummary[]> {
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
        books.status,
        books.published_at AS publishedAt,
        books.updated_at AS updatedAt,
        COUNT(DISTINCT chapters.id) AS chapterCount,
        COUNT(DISTINCT translations.id) AS translationCount,
        COUNT(DISTINCT CASE WHEN translations.status IN ('ready', 'published') THEN translations.id END) AS readyTranslationCount,
        COUNT(DISTINCT CASE WHEN ingest.status = 'saved' THEN ingest.id END) AS savedChapterCount,
        MAX(COALESCE(ingest.updated_at, translations.updated_at, chapters.updated_at, books.updated_at)) AS latestActivityAt
      FROM books
      LEFT JOIN chapters
        ON chapters.book_id = books.id
      LEFT JOIN translations
        ON translations.book_id = books.id
      LEFT JOIN admin_ingestion_sessions AS sessions
        ON sessions.translation_id = translations.id
      LEFT JOIN admin_ingestion_chapters AS ingest
        ON ingest.session_id = sessions.id
      GROUP BY books.id
      ORDER BY latestActivityAt DESC, books.title ASC
    `,
    )
    .all<AdminBookWorkflowSummary & { updatedAt: string; latestActivityAt: string | null }>();

  return (results.results ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    author: row.author,
    originalLanguage: row.originalLanguage,
    description: row.description,
    coverImageUrl: row.coverImageUrl,
    status: row.status,
    publishedAt: row.publishedAt,
    chapterCount: Number(row.chapterCount ?? 0),
    translationCount: Number(row.translationCount ?? 0),
    readyTranslationCount: Number(row.readyTranslationCount ?? 0),
    savedChapterCount: Number(row.savedChapterCount ?? 0),
    latestActivityAt: row.latestActivityAt ?? row.updatedAt,
  }));
}

export async function listAdminTranslations(db: D1Database, bookSlug: string): Promise<AdminTranslationSummary[]> {
  const book = await db.prepare(`SELECT id FROM books WHERE slug = ?`).bind(bookSlug).first<{ id: string }>();

  if (!book) {
    return [];
  }

  const results = await db
    .prepare(
      `
      SELECT
        translations.id,
        translations.book_id AS bookId,
        ? AS bookSlug,
        translations.slug,
        translations.name,
        translations.description,
        translations.ai_system_prompt AS aiSystemPrompt,
        translations.output_r2_prefix AS outputR2Prefix,
        translations.status,
        translations.created_at AS createdAt,
        translations.updated_at AS updatedAt,
        MAX(COALESCE(chapters.updated_at, sessions.updated_at, translations.updated_at)) AS latestActivityAt,
        COUNT(DISTINCT sessions.id) AS sessionCount
      FROM translations
      LEFT JOIN admin_ingestion_sessions AS sessions
        ON sessions.translation_id = translations.id
      LEFT JOIN admin_ingestion_chapters AS chapters
        ON chapters.session_id = sessions.id
      WHERE translations.book_id = ?
      GROUP BY translations.id
      ORDER BY translations.name ASC
    `,
    )
    .bind(bookSlug, book.id)
    .all<AdminTranslationRow>();

  return hydrateTranslationSummaries(db, results.results ?? []);
}

export async function getAdminTranslationDetail(
  db: D1Database,
  translationId: string,
): Promise<AdminTranslationDetail | null> {
  const row = await db
    .prepare(
      `
      SELECT
        translations.id,
        translations.book_id AS bookId,
        books.slug AS bookSlug,
        translations.slug,
        translations.name,
        translations.description,
        translations.ai_system_prompt AS aiSystemPrompt,
        translations.output_r2_prefix AS outputR2Prefix,
        translations.status,
        translations.created_at AS createdAt,
        translations.updated_at AS updatedAt,
        MAX(COALESCE(chapters.updated_at, sessions.updated_at, translations.updated_at)) AS latestActivityAt,
        COUNT(DISTINCT sessions.id) AS sessionCount
      FROM translations
      JOIN books
        ON books.id = translations.book_id
      LEFT JOIN admin_ingestion_sessions AS sessions
        ON sessions.translation_id = translations.id
      LEFT JOIN admin_ingestion_chapters AS chapters
        ON chapters.session_id = sessions.id
      WHERE translations.id = ?
      GROUP BY translations.id
    `,
    )
    .bind(translationId)
    .first<AdminTranslationRow>();

  if (!row) {
    return null;
  }

  const [summary] = await hydrateTranslationSummaries(db, [row]);
  if (!summary) {
    return null;
  }

  const sessions = await listAdminIngestionSessionsByTranslationId(db, translationId);
  const currentSessionSummary = sessions[0] ?? null;
  const currentSession = currentSessionSummary
    ? await getAdminIngestionSessionDetail(db, currentSessionSummary.id)
    : null;

  return {
    ...summary,
    currentSession,
    sessions,
  };
}

async function hydrateTranslationSummaries(
  db: D1Database,
  rows: AdminTranslationRow[],
): Promise<AdminTranslationSummary[]> {
  const latestSessions = await Promise.all(
    rows.map(async (row) => {
      const latestSession = await db
        .prepare(
          `
            SELECT id
            FROM admin_ingestion_sessions
            WHERE translation_id = ?
            ORDER BY updated_at DESC
            LIMIT 1
          `,
        )
        .bind(row.id)
        .first<{ id: string }>();

      return latestSession ? getAdminIngestionSessionSummaryById(db, latestSession.id) : null;
    }),
  );

  return Promise.all(
    rows.map(async (row, index) => {
      const count = await countTranslationProgress(db, row.id);

      return {
        id: row.id,
        bookSlug: row.bookSlug,
        slug: row.slug,
        name: row.name,
        description: row.description,
        outputR2Prefix: row.outputR2Prefix,
        status: row.status,
        aiSystemPrompt: row.aiSystemPrompt,
        latestSession: latestSessions[index] ?? null,
        sessionCount: Number(row.sessionCount ?? 0),
        chapterCount: count.chapterCount,
        savedChapterCount: count.savedChapterCount,
        generatedChapterCount: count.generatedChapterCount,
        pendingChapterCount: count.pendingChapterCount,
        latestActivityAt: row.latestActivityAt ?? row.updatedAt,
      };
    }),
  );
}

async function countTranslationProgress(
  db: D1Database,
  translationId: string,
): Promise<{
  chapterCount: number;
  savedChapterCount: number;
  generatedChapterCount: number;
  pendingChapterCount: number;
}> {
  const result = await db
    .prepare(
      `
        SELECT
          COUNT(chapters.id) AS chapterCount,
          COUNT(CASE WHEN chapters.status = 'saved' THEN 1 END) AS savedChapterCount,
          COUNT(CASE WHEN chapters.status = 'generated' THEN 1 END) AS generatedChapterCount,
          COUNT(CASE WHEN chapters.status = 'pending' THEN 1 END) AS pendingChapterCount
        FROM admin_ingestion_sessions AS sessions
        LEFT JOIN admin_ingestion_chapters AS chapters
          ON chapters.session_id = sessions.id
        WHERE sessions.translation_id = ?
          AND sessions.id = (
            SELECT latest.id
            FROM admin_ingestion_sessions AS latest
            WHERE latest.translation_id = sessions.translation_id
            ORDER BY latest.updated_at DESC
            LIMIT 1
          )
      `,
    )
    .bind(translationId)
    .first<{
      chapterCount: number;
      savedChapterCount: number;
      generatedChapterCount: number;
      pendingChapterCount: number;
    }>();

  return {
    chapterCount: Number(result?.chapterCount ?? 0),
    savedChapterCount: Number(result?.savedChapterCount ?? 0),
    generatedChapterCount: Number(result?.generatedChapterCount ?? 0),
    pendingChapterCount: Number(result?.pendingChapterCount ?? 0),
  };
}

export async function listAdminIngestionSessions(
  db: D1Database,
  sourceBookSlug?: string,
): Promise<AdminIngestionSessionSummary[]> {
  const results = await db
    .prepare(
      `
      SELECT
        sessions.id,
        sessions.title,
        sessions.source_mode AS sourceMode,
        sessions.source_book_slug AS sourceBookSlug,
        sessions.translation_id AS translationId,
        sessions.provider,
        sessions.model,
        sessions.thinking_level AS thinkingLevel,
        sessions.context_before_chapter_count AS contextBeforeChapterCount,
        sessions.context_after_chapter_count AS contextAfterChapterCount,
        sessions.current_chapter_index AS currentChapterIndex,
        sessions.created_at AS createdAt,
        sessions.updated_at AS updatedAt,
        COUNT(chapters.id) AS chapterCount
      FROM admin_ingestion_sessions AS sessions
      LEFT JOIN admin_ingestion_chapters AS chapters
        ON chapters.session_id = sessions.id
      WHERE (?1 IS NULL OR sessions.source_book_slug = ?1)
      GROUP BY sessions.id
      ORDER BY sessions.updated_at DESC
    `,
    )
    .bind(sourceBookSlug ?? null)
    .all<AdminIngestionSessionRow>();

  return (results.results ?? []).map(mapAdminIngestionSessionSummary);
}

async function listAdminIngestionSessionsByTranslationId(
  db: D1Database,
  translationId: string,
): Promise<AdminIngestionSessionSummary[]> {
  const results = await db
    .prepare(
      `
        SELECT
          sessions.id,
          sessions.title,
          sessions.source_mode AS sourceMode,
          sessions.source_book_slug AS sourceBookSlug,
          sessions.translation_id AS translationId,
          sessions.provider,
          sessions.model,
          sessions.thinking_level AS thinkingLevel,
          sessions.prompt,
          sessions.context_before_chapter_count AS contextBeforeChapterCount,
          sessions.context_after_chapter_count AS contextAfterChapterCount,
          sessions.current_chapter_index AS currentChapterIndex,
          sessions.created_at AS createdAt,
          sessions.updated_at AS updatedAt,
          COUNT(chapters.id) AS chapterCount
        FROM admin_ingestion_sessions AS sessions
        LEFT JOIN admin_ingestion_chapters AS chapters
          ON chapters.session_id = sessions.id
        WHERE sessions.translation_id = ?
        GROUP BY sessions.id
        ORDER BY sessions.updated_at DESC
      `,
    )
    .bind(translationId)
    .all<AdminIngestionSessionRow>();

  return (results.results ?? []).map(mapAdminIngestionSessionSummary);
}

async function getAdminIngestionSessionSummaryById(
  db: D1Database,
  sessionId: string,
): Promise<AdminIngestionSessionSummary | null> {
  const result = await db
    .prepare(
      `
        SELECT
          sessions.id,
          sessions.title,
          sessions.source_mode AS sourceMode,
          sessions.source_book_slug AS sourceBookSlug,
          sessions.translation_id AS translationId,
          sessions.provider,
          sessions.model,
          sessions.thinking_level AS thinkingLevel,
          sessions.prompt,
          sessions.context_before_chapter_count AS contextBeforeChapterCount,
          sessions.context_after_chapter_count AS contextAfterChapterCount,
          sessions.current_chapter_index AS currentChapterIndex,
          sessions.created_at AS createdAt,
          sessions.updated_at AS updatedAt,
          COUNT(chapters.id) AS chapterCount
        FROM admin_ingestion_sessions AS sessions
        LEFT JOIN admin_ingestion_chapters AS chapters
          ON chapters.session_id = sessions.id
        WHERE sessions.id = ?
        GROUP BY sessions.id
      `,
    )
    .bind(sessionId)
    .first<AdminIngestionSessionRow>();

  return result ? mapAdminIngestionSessionSummary(result) : null;
}

export async function getAdminIngestionSessionRow(
  db: D1Database,
  sessionId: string,
): Promise<AdminIngestionSessionDetail | null> {
  return getAdminIngestionSessionDetail(db, sessionId);
}

export async function getAdminIngestionSessionDetail(
  db: D1Database,
  sessionId: string,
): Promise<AdminIngestionSessionDetail | null> {
  const session = await db
    .prepare(
      `
        SELECT
          id,
          title,
          source_mode AS sourceMode,
          source_book_slug AS sourceBookSlug,
          translation_id AS translationId,
          provider,
          model,
          thinking_level AS thinkingLevel,
          prompt,
          context_before_chapter_count AS contextBeforeChapterCount,
          context_after_chapter_count AS contextAfterChapterCount,
          current_chapter_index AS currentChapterIndex,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM admin_ingestion_sessions
        WHERE id = ?
      `,
    )
    .bind(sessionId)
    .first<AdminIngestionSessionRow>();

  if (!session) {
    return null;
  }

  const chapterResults = await db
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
      WHERE session_id = ?
      ORDER BY position ASC
    `,
    )
    .bind(sessionId)
    .all<AdminIngestionChapterRow>();

  const chapters = (chapterResults.results ?? []).map(mapAdminIngestionChapterRecord);

  return {
    ...mapAdminIngestionSessionSummary({
      ...session,
      chapterCount: chapters.length,
    }),
    prompt: session.prompt,
    chapters,
  };
}

function mapAdminIngestionSessionSummary(row: AdminIngestionSessionRow): AdminIngestionSessionSummary {
  return {
    id: row.id,
    title: row.title,
    sourceMode: row.sourceMode,
    sourceBookSlug: row.sourceBookSlug,
    translationId: row.translationId,
    provider: row.provider,
    model: row.model,
    thinkingLevel: row.thinkingLevel,
    contextBeforeChapterCount: Number(row.contextBeforeChapterCount ?? 1),
    contextAfterChapterCount: Number(row.contextAfterChapterCount ?? 1),
    currentChapterIndex: Number(row.currentChapterIndex ?? 0),
    chapterCount: Number(row.chapterCount ?? 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapAdminIngestionChapterRecord(row: AdminIngestionChapterRow): AdminIngestionChapterRecord {
  return {
    id: row.id,
    position: Number(row.position),
    title: row.title,
    slug: row.slug,
    sourceText: row.sourceText,
    sourceChapterSlug: row.sourceChapterSlug,
    status: row.status,
    rawResponse: row.rawResponse,
    originalDocument: parseJsonOrNull<OriginalChapterDocument>(row.originalDocumentJson),
    translationDocument: parseJsonOrNull<TranslationChapterDocument>(row.translationDocumentJson),
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

export function normalizePastedChapterInputs(chapters: AdminIngestionChapterInput[]): AdminIngestionChapterInput[] {
  return chapters
    .map((chapter, index) => ({
      position: index,
      title: chapter.title.trim(),
      slug: slugify(chapter.slug || chapter.title || `chapter-${index + 1}`),
      sourceText: chapter.sourceText.trim(),
      sourceChapterSlug: chapter.sourceChapterSlug?.trim() || null,
    }))
    .filter((chapter) => chapter.title && chapter.sourceText)
    .map((chapter, index) => ({ ...chapter, position: index }));
}

export async function buildChapterInputsFromExistingStory(
  db: D1Database,
  bucket: R2Bucket,
  bookSlug?: string,
): Promise<AdminIngestionChapterInput[]> {
  if (!bookSlug) {
    return [];
  }

  const book = await db.prepare(`SELECT id FROM books WHERE slug = ?`).bind(bookSlug).first<{ id: string }>();
  if (!book) {
    return [];
  }

  const chaptersResult = await db
    .prepare(
      `
        SELECT
          id,
          book_id AS bookId,
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
    .all<AdminBookChapterRow>();

  const chapterRows = chaptersResult.results ?? [];

  return Promise.all(
    chapterRows.map(async (chapter) => {
      const original = await readObjectJson<OriginalChapterDocument>(bucket, chapter.sourceR2Key);
      return {
        position: chapter.position,
        title: chapter.title,
        slug: chapter.slug,
        sourceText: original ? sourceDocumentToText(original) : "",
        sourceChapterSlug: chapter.slug,
      };
    }),
  );
}

function sourceDocumentToText(document: OriginalChapterDocument): string {
  return document.fullText;
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
          status,
          published_at AS publishedAt
        FROM books
        WHERE slug = ?
      `,
    )
    .bind(bookSlug)
    .first<BookSummary>();

  if (!book) {
    return null;
  }

  const [chaptersResult, translationsResult] = await Promise.all([
    db
      .prepare(
        `
        SELECT
          id,
          book_id AS bookId,
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
      .all<AdminBookChapterRow>(),
    db
      .prepare(
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

  const chapters = chaptersResult.results ?? [];
  const sourceChapterInputs: AdminBookChapterInput[] = [];

  for (const chapter of chapters) {
    const original = await readObjectJson<OriginalChapterDocument>(bucket, chapter.sourceR2Key);
    sourceChapterInputs.push({
      position: chapter.position,
      title: chapter.title,
      slug: chapter.slug,
      sourceText: original ? sourceDocumentToText(original) : "",
    });
  }

  return {
    book: {
      ...book,
      chapters,
      translations: translationsResult.results ?? [],
    } as BookDetail,
    chapters: sourceChapterInputs,
  };
}

export function buildInitialOriginalDocument(
  bookSlug: string,
  chapterSlug: string,
  sourceText: string,
): OriginalChapterDocument {
  return {
    bookSlug,
    chapterSlug,
    fullText: sourceText.trim(),
  };
}

export async function createAdminIngestionSessionForBook(input: {
  db: D1Database;
  bucket: R2Bucket;
  bookSlug: string;
  title: string;
  provider: AiProvider;
  model: string;
  thinkingLevel: ThinkingLevel | null;
  prompt: string;
  translationId: string | null;
  contextBeforeChapterCount: number;
  contextAfterChapterCount: number;
}): Promise<AdminIngestionSessionDetail | null> {
  const chapters = await buildChapterInputsFromExistingStory(input.db, input.bucket, input.bookSlug);
  const now = new Date().toISOString();
  const sessionId = crypto.randomUUID();

  await input.db
    .prepare(
      `
      INSERT INTO admin_ingestion_sessions (
        id,
        title,
        source_mode,
        source_book_slug,
        translation_id,
        provider,
        model,
        thinking_level,
        prompt,
        context_before_chapter_count,
        context_after_chapter_count,
        current_chapter_index,
        created_at,
        updated_at
      ) VALUES (?, ?, 'existing_story', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `,
    )
    .bind(
      sessionId,
      input.title,
      input.bookSlug,
      input.translationId,
      input.provider,
      input.model,
      input.thinkingLevel,
      input.prompt,
      Math.max(0, input.contextBeforeChapterCount),
      Math.max(0, input.contextAfterChapterCount),
      now,
      now,
    )
    .run();

  for (const chapter of chapters) {
    await input.db
      .prepare(
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

  return getAdminIngestionSessionDetail(input.db, sessionId);
}

export async function validateTranslation(
  db: D1Database,
  translationId: string,
): Promise<AdminTranslationValidationPayload | null> {
  const translation = await getAdminTranslationDetail(db, translationId);
  const session = translation?.currentSession;

  if (!translation || !session) {
    return null;
  }

  const chapterChecks = session.chapters.map((chapter) => {
    const issues: AdminTranslationValidationPayload["chapters"][number]["issues"] = [];

    if (!chapter.originalDocument?.fullText.trim()) {
      issues.push({
        level: "error",
        message: "Original chapter text is missing.",
        chapterPosition: chapter.position,
        chapterSlug: chapter.slug,
      });
    }

    if (!chapter.translationDocument || chapter.translationDocument.chunks.length === 0) {
      issues.push({
        level: "error",
        message: "Translation chunks are missing.",
        chapterPosition: chapter.position,
        chapterSlug: chapter.slug,
      });
    }

    for (const translationChunk of chapter.translationDocument?.chunks ?? []) {
      if (!translationChunk.originalText.trim()) {
        issues.push({
          level: "error",
          message: `Translation chunk ${translationChunk.id} is missing original text.`,
          chapterPosition: chapter.position,
          chapterSlug: chapter.slug,
          translationChunkId: translationChunk.id,
        });
      }

      if (!translationChunk.translatedText.trim()) {
        issues.push({
          level: "error",
          message: `Translation chunk ${translationChunk.id} is missing translated text.`,
          chapterPosition: chapter.position,
          chapterSlug: chapter.slug,
          translationChunkId: translationChunk.id,
        });
      }
    }

    const originalFullText = chapter.originalDocument?.fullText ?? "";
    const reconstructedOriginalText = (chapter.translationDocument?.chunks ?? [])
      .map((chunk) => chunk.originalText)
      .join("\n\n");

    if (
      chapter.originalDocument &&
      chapter.translationDocument &&
      normalizeChapterText(originalFullText) !== normalizeChapterText(reconstructedOriginalText)
    ) {
      issues.push({
        level: "error",
        message: "Translation chunk original text does not exactly reconstruct the chapter source text.",
        chapterPosition: chapter.position,
        chapterSlug: chapter.slug,
      });
    }

    if (chapter.status !== "saved") {
      issues.push({
        level: "warning",
        message: `Chapter is currently marked ${chapter.status}.`,
        chapterPosition: chapter.position,
        chapterSlug: chapter.slug,
      });
    }

    return {
      position: chapter.position,
      title: chapter.title,
      slug: chapter.slug,
      status: chapter.status,
      issues,
    };
  });

  const issues = chapterChecks.flatMap((chapter) => chapter.issues);

  return {
    session,
    isValid: issues.every((issue) => issue.level !== "error"),
    issues,
    chapters: chapterChecks,
  };
}

export async function seedInitialOriginalDocument(input: {
  bucket: R2Bucket;
  bookSlug: string;
  chapterSlug: string;
  sourceText: string;
}): Promise<OriginalChapterDocument> {
  const originalDocument = buildInitialOriginalDocument(input.bookSlug, input.chapterSlug, input.sourceText);
  await writeObjectJson(input.bucket, buildOriginalChapterKey(input.bookSlug, input.chapterSlug), originalDocument);
  return originalDocument;
}

function normalizeChapterText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}
