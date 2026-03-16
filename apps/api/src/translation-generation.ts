import {
  buildTranslationChapterKey,
  type AdminTranslationDetail,
  type AiProvider,
  type ChunkType,
  type ThinkingLevel,
  type TranslationChapterDocument,
  type TranslationChapterDraft,
  type TranslationChapterStatus,
} from "@ancient-epics/shared";
import { writeObjectJson } from "./http";

type ParsedAiChunk = {
  originalText: string;
  translatedText: string;
  type?: ChunkType;
};

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

export async function generateTranslationChapterWithProvider(input: {
  provider: AiProvider;
  model: string;
  thinkingLevel: ThinkingLevel | null;
  prompt: string;
  translation: AdminTranslationDetail;
  chapter: TranslationChapterDraft;
  previousChapters?: TranslationChapterDraft[];
  nextChapters?: TranslationChapterDraft[];
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
    translationId: input.translation.id,
    chapterId: input.chapter.chapterId,
    chapterPosition: input.chapter.position,
    chapterSlug: input.chapter.slug,
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
    translationId: input.translation.id,
    chapterId: input.chapter.chapterId,
    chapterPosition: input.chapter.position,
    chapterSlug: input.chapter.slug,
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

export async function saveTranslationChapterDraft(input: {
  db: D1Database;
  translation: Pick<AdminTranslationDetail, "id" | "slug">;
  chapter: TranslationChapterDraft;
  rawResponse: string;
  statusOnSuccess: Extract<TranslationChapterStatus, "draft" | "saved">;
}): Promise<TranslationChapterDraft> {
  const now = new Date().toISOString();

  try {
    const normalized = normalizeTranslationChapter({
      translationSlug: input.translation.slug,
      rawResponse: input.rawResponse,
    });

    await input.db
      .prepare(
        `
          UPDATE translation_chapters
          SET status = ?, raw_response = ?, content_json = ?, notes = ?, error_message = NULL, updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(
        input.statusOnSuccess,
        input.rawResponse,
        JSON.stringify(normalized.content),
        normalized.notes,
        now,
        input.chapter.id,
      )
      .run();

    await touchTranslation(input.db, input.translation.id, now);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to parse AI response.";

    await input.db
      .prepare(
        `
          UPDATE translation_chapters
          SET status = 'error', raw_response = ?, error_message = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .bind(input.rawResponse, message, now, input.chapter.id)
      .run();

    await touchTranslation(input.db, input.translation.id, now);
  }

  const refreshed = await input.db
    .prepare(
      `
        SELECT
          status,
          raw_response AS rawResponse,
          content_json AS contentJson,
          notes,
          error_message AS errorMessage,
          updated_at AS updatedAt
        FROM translation_chapters
        WHERE id = ?
      `,
    )
    .bind(input.chapter.id)
    .first<{
      status: TranslationChapterDraft["status"];
      rawResponse: string | null;
      contentJson: string | null;
      notes: string | null;
      errorMessage: string | null;
      updatedAt: string;
    }>();

  if (!refreshed) {
    throw new Error("Draft chapter could not be reloaded.");
  }

  return {
    ...input.chapter,
    status: refreshed.status,
    rawResponse: refreshed.rawResponse,
    content: refreshed.contentJson ? (JSON.parse(refreshed.contentJson) as TranslationChapterDocument) : null,
    notes: refreshed.notes,
    errorMessage: refreshed.errorMessage,
    updatedAt: refreshed.updatedAt,
  };
}

export async function publishTranslationChapters(input: {
  bucket: R2Bucket;
  bookSlug: string;
  translationSlug: string;
  chapters: TranslationChapterDraft[];
}): Promise<string[]> {
  const warnings: string[] = [];

  for (const chapter of input.chapters) {
    if (!chapter.content) {
      warnings.push(`Chapter ${chapter.position} "${chapter.title}" has no saved translation content.`);
      continue;
    }

    await writeObjectJson(
      input.bucket,
      buildTranslationChapterKey(input.bookSlug, chapter.slug, input.translationSlug),
      chapter.content,
    );
  }

  return warnings;
}

function formatContextChapters(chapters: TranslationChapterDraft[] | undefined): string {
  if (!chapters || chapters.length === 0) {
    return "(none)";
  }

  return chapters
    .map((chapter) => {
      let content = `## ${chapter.title}\nSource Text:\n${chapter.sourceText}`;
      if (chapter.content) {
        const translatedText = chapter.content.chunks.map((chunk) => chunk.translatedText).join("\n");
        content += `\n\nTranslated Text:\n${translatedText}`;
      }
      return content;
    })
    .join("\n\n");
}

function buildGenerationUserPrompt(input: {
  translation: AdminTranslationDetail;
  chapter: TranslationChapterDraft;
  previousChapters?: TranslationChapterDraft[];
  nextChapters?: TranslationChapterDraft[];
}): string {
  return [
    `Project: ${input.translation.name}`,
    `Provider: ${input.translation.provider}`,
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

function normalizeTranslationChapter(input: {
  translationSlug: string;
  rawResponse: string;
}): {
  content: TranslationChapterDocument;
  notes: string | null;
} {
  const parsed = parseAiChapterPayload(input.rawResponse);

  return {
    content: {
      translationSlug: input.translationSlug,
      chunks: parsed.chunks.map((chunk, index) => ({
        id: `t${index + 1}`,
        type: chunk.type ?? inferChunkType(chunk.originalText),
        originalText: chunk.originalText,
        translatedText: chunk.translatedText,
        ordinal: index + 1,
      })),
    },
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

async function touchTranslation(db: D1Database, translationId: string, now: string): Promise<void> {
  await db.prepare(`UPDATE translations SET updated_at = ? WHERE id = ?`).bind(now, translationId).run();
}
