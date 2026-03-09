import {
  buildTranslationChapterKey,
  type AdminIngestionChapterRecord,
  type AdminIngestionSessionDetail,
  type AiProvider,
  type ChunkType,
  type OriginalChapterDocument,
  type ThinkingLevel,
  type TranslationChapterDocument,
} from "@ancient-epics/shared";
import { slugify, writeObjectJson } from "./http";

type ParsedAiChunk = { originalText: string; translatedText: string; type?: ChunkType };
type ParsedAiChapterPayload = {
  chapterTitle?: string;
  notes?: string;
  chunks: ParsedAiChunk[];
};

export type ProviderCallInput = {
  model: string;
  thinkingLevel: ThinkingLevel | null;
  systemPrompt: string;
  userPrompt: string;
};

export type ProviderCallResult = {
  requestPayload: Record<string, unknown>;
  responseStatus: number;
  responsePayload: unknown;
  extractedContent: string;
};

export async function generateChapterWithProvider(input: {
  provider: AiProvider;
  model: string;
  thinkingLevel: ThinkingLevel | null;
  prompt: string;
  session: AdminIngestionSessionDetail;
  chapter: AdminIngestionChapterRecord;
  previousChapters?: AdminIngestionChapterRecord[];
  nextChapters?: AdminIngestionChapterRecord[];
  callModel: (input: ProviderCallInput) => Promise<ProviderCallResult>;
  logEntry?: (entry: Record<string, unknown>) => Promise<void>;
}): Promise<string> {
  const initialResult = await input.callModel({
    model: input.model,
    thinkingLevel: input.thinkingLevel,
    systemPrompt: input.prompt,
    userPrompt: buildGenerationUserPrompt(input),
  });

  const initialValidation = validateAiChapterPayloadText(initialResult.extractedContent);
  await input.logEntry?.({
    timestamp: new Date().toISOString(),
    provider: input.provider,
    sessionId: input.session.id,
    chapterId: input.chapter.id,
    chapterPosition: input.chapter.position,
    chapterSlug: input.chapter.slug,
    translationId: input.session.translationId,
    model: input.model,
    attempt: "initial",
    requestPayload: initialResult.requestPayload,
    responseStatus: initialResult.responseStatus,
    responsePayload: initialResult.responsePayload,
    extractedContent: initialResult.extractedContent,
    validationError: initialValidation.ok ? undefined : initialValidation.error,
  });

  if (initialValidation.ok) {
    return initialResult.extractedContent;
  }

  const repairedResult = await input.callModel({
    model: input.model,
    thinkingLevel: input.thinkingLevel,
    systemPrompt: "Repair the user's JSON so it matches the required schema exactly. Return JSON only.",
    userPrompt: buildRepairUserPrompt({
      originalError: initialValidation.error,
      rawResponse: initialResult.extractedContent,
    }),
  });

  const repairedValidation = validateAiChapterPayloadText(repairedResult.extractedContent);
  await input.logEntry?.({
    timestamp: new Date().toISOString(),
    provider: input.provider,
    sessionId: input.session.id,
    chapterId: input.chapter.id,
    chapterPosition: input.chapter.position,
    chapterSlug: input.chapter.slug,
    translationId: input.session.translationId,
    model: input.model,
    attempt: "repair",
    requestPayload: repairedResult.requestPayload,
    responseStatus: repairedResult.responseStatus,
    responsePayload: repairedResult.responsePayload,
    extractedContent: repairedResult.extractedContent,
    validationError: repairedValidation.ok ? undefined : repairedValidation.error,
  });

  if (repairedValidation.ok) {
    return repairedResult.extractedContent;
  }

  throw new Error(`Model response failed validation after repair: ${repairedValidation.error}`);
}

export async function persistGeneratedChapter(input: {
  db: D1Database;
  bucket: R2Bucket;
  session: AdminIngestionSessionDetail;
  chapter: AdminIngestionChapterRecord;
  rawResponse: string;
  statusOnSuccess: AdminIngestionChapterRecord["status"];
}): Promise<AdminIngestionChapterRecord> {
  const now = new Date().toISOString();
  let translationSlug: string | undefined;

  if (input.session.translationId) {
    const translation = await input.db
      .prepare(`SELECT slug FROM translations WHERE id = ?`)
      .bind(input.session.translationId)
      .first<{ slug: string }>();
    translationSlug = translation?.slug;
  }

  try {
    const normalized = normalizeGeneratedChapter({
      session: input.session,
      chapter: input.chapter,
      rawResponse: input.rawResponse,
      translationSlug,
    });

    await input.db
      .prepare(
        `
          UPDATE admin_ingestion_chapters
          SET status = ?, raw_response = ?, original_document_json = ?, translation_document_json = ?, notes = ?, error_message = NULL, updated_at = ?
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

    if (
      input.session.translationId &&
      input.session.sourceBookSlug &&
      input.statusOnSuccess === "saved" &&
      translationSlug
    ) {
      await writeObjectJson(
        input.bucket,
        buildTranslationChapterKey(input.session.sourceBookSlug, input.chapter.slug, translationSlug),
        normalized.translationDocument,
      );

      await input.db
        .prepare(
          `
            UPDATE translations
            SET ai_system_prompt = ?, status = 'ready', updated_at = ?
            WHERE id = ?
          `,
        )
        .bind(input.session.prompt, now, input.session.translationId)
        .run();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to parse AI response.";
    await input.db
      .prepare(
        `
          UPDATE admin_ingestion_chapters
          SET status = 'error', raw_response = ?, error_message = ?, updated_at = ?
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
    .first<{
      id: string;
      position: number;
      title: string;
      slug: string;
      sourceText: string;
      sourceChapterSlug: string | null;
      status: AdminIngestionChapterRecord["status"];
      rawResponse: string | null;
      originalDocumentJson: string | null;
      translationDocumentJson: string | null;
      notes: string | null;
      errorMessage: string | null;
      updatedAt: string;
    }>();

  if (!refreshed) {
    throw new Error("Generated chapter could not be reloaded.");
  }

  return {
    id: refreshed.id,
    position: Number(refreshed.position),
    title: refreshed.title,
    slug: refreshed.slug,
    sourceText: refreshed.sourceText,
    sourceChapterSlug: refreshed.sourceChapterSlug,
    status: refreshed.status,
    rawResponse: refreshed.rawResponse,
    originalDocument: refreshed.originalDocumentJson
      ? (JSON.parse(refreshed.originalDocumentJson) as OriginalChapterDocument)
      : null,
    translationDocument: refreshed.translationDocumentJson
      ? (JSON.parse(refreshed.translationDocumentJson) as TranslationChapterDocument)
      : null,
    notes: refreshed.notes,
    errorMessage: refreshed.errorMessage,
    updatedAt: refreshed.updatedAt,
  };
}

function formatContextChapters(chapters: AdminIngestionChapterRecord[] | undefined): string {
  if (!chapters || chapters.length === 0) {
    return "(none)";
  }

  return chapters
    .map((chapter) => {
      let content = `## ${chapter.title}\nSource Text:\n${chapter.sourceText}`;
      if (chapter.translationDocument) {
        const translatedText = chapter.translationDocument.chunks.map((chunk) => chunk.translatedText).join("\n");
        content += `\n\nTranslated Text:\n${translatedText}`;
      }
      return content;
    })
    .join("\n\n");
}

function buildGenerationUserPrompt(input: {
  session: AdminIngestionSessionDetail;
  chapter: AdminIngestionChapterRecord;
  previousChapters?: AdminIngestionChapterRecord[];
  nextChapters?: AdminIngestionChapterRecord[];
}): string {
  return [
    `Project: ${input.session.title}`,
    `Source mode: ${input.session.sourceMode}`,
    `Provider: ${input.session.provider}`,
    `Chapter title: ${input.chapter.title}`,
    "",
    "Return JSON only.",
    "Schema: { chapterTitle?: string, notes?: string, chunks: [{ originalText: string, translatedText: string, type?: 'prose' | 'verse' }] }",
    "Each chunk must contain non-empty originalText, non-empty translatedText, and optional type.",
    "Split the chapter into paired chunks. The concatenation of all originalText values must reproduce the full source chapter without dropping or duplicating content.",
    "Do not include ids. The application assigns ids after review.",
    "",
    "Previous chapter context:",
    formatContextChapters(input.previousChapters),
    "",
    "Target chapter source text:",
    input.chapter.sourceText,
    "",
    "Next chapter context:",
    formatContextChapters(input.nextChapters),
  ].join("\n");
}

function buildRepairUserPrompt(input: { originalError: string; rawResponse: string }): string {
  return [
    "Repair this model output into valid JSON matching the required schema.",
    `Validation error: ${input.originalError}`,
    "Required schema:",
    "{ chapterTitle?: string, notes?: string, chunks: [{ originalText: string, translatedText: string, type?: 'prose' | 'verse' }] }",
    "Return JSON only.",
    "",
    input.rawResponse,
  ].join("\n");
}

function normalizeGeneratedChapter(input: {
  session: AdminIngestionSessionDetail;
  chapter: AdminIngestionChapterRecord;
  rawResponse: string;
  translationSlug?: string;
}): {
  originalDocument: OriginalChapterDocument;
  translationDocument: TranslationChapterDocument;
  notes: string | null;
} {
  const parsed = parseAiChapterPayload(input.rawResponse);

  const originalDocument: OriginalChapterDocument = {
    bookSlug: input.session.sourceBookSlug ?? slugify(input.session.title),
    chapterSlug: input.chapter.slug,
    fullText: input.chapter.sourceText.trim(),
  };

  const translationDocument: TranslationChapterDocument = {
    translationSlug: input.translationSlug ?? `${slugify(input.session.title)}-draft`,
    chunks: parsed.chunks.map((chunk, index) => ({
      id: `t${index + 1}`,
      type: chunk.type ?? inferChunkType(chunk.originalText),
      originalText: chunk.originalText,
      translatedText: chunk.translatedText,
      ordinal: index + 1,
    })),
  };

  if (!originalTextReconstructsSource(originalDocument.fullText, translationDocument.chunks)) {
    throw new Error("Chunked originalText must exactly reconstruct the chapter source text.");
  }

  return {
    originalDocument,
    translationDocument,
    notes: parsed.notes?.trim() || null,
  };
}

function parseAiChapterPayload(rawResponse: string): ParsedAiChapterPayload {
  const parsed = JSON.parse(extractJsonObject(rawResponse)) as Record<string, unknown>;
  const payload: ParsedAiChapterPayload = {
    chapterTitle: typeof parsed.chapterTitle === "string" ? parsed.chapterTitle : undefined,
    notes: typeof parsed.notes === "string" ? parsed.notes : undefined,
    chunks: Array.isArray(parsed.chunks)
      ? parsed.chunks.map(normalizeAiChunk).filter((value): value is ParsedAiChunk => Boolean(value))
      : [],
  };

  if (payload.chunks.length === 0) {
    throw new Error("chunks must contain at least one item.");
  }

  return payload;
}

function validateAiChapterPayloadText(rawResponse: string): { ok: true } | { ok: false; error: string } {
  try {
    parseAiChapterPayload(rawResponse);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown schema validation error." };
  }
}

function normalizeAiChunk(value: unknown): ParsedAiChunk | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const originalText = typeof entry.originalText === "string" ? entry.originalText : "";
  const translatedText = typeof entry.translatedText === "string" ? entry.translatedText : "";
  if (!originalText.trim() || !translatedText.trim()) {
    return null;
  }
  return {
    originalText,
    translatedText,
    type: normalizeChunkType(entry.type),
  };
}

function normalizeChunkType(value: unknown): ChunkType | undefined {
  return value === "verse" || value === "prose" ? value : undefined;
}

function inferChunkType(text: string): ChunkType {
  return text.includes("\n") ? "verse" : "prose";
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Response did not include a JSON object.");
  }
  return trimmed.slice(start, end + 1);
}

function normalizeChapterText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function originalTextReconstructsSource(sourceText: string, chunks: TranslationChapterDocument["chunks"]): boolean {
  return normalizeChapterText(sourceText) === normalizeChapterText(chunks.map((chunk) => chunk.originalText).join(""));
}
