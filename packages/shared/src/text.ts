import type { AccessLevel, AiProvider, ThinkingLevel, TranslationChunk } from "./types";

export function normalizeChapterText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

export function reconstructSourceTextFromChunks(chunks: Array<Pick<TranslationChunk, "originalText">>): string {
  const normalizedChunks = chunks.map((chunk) => normalizeChunkText(chunk.originalText));
  return normalizedChunks.join("");
}

export function originalTextReconstructsSource(
  sourceText: string,
  chunks: Array<Pick<TranslationChunk, "originalText">>,
): boolean {
  return normalizeChapterText(sourceText) === normalizeChapterText(reconstructSourceTextFromChunks(chunks));
}

export function slugify(value: string, fallback = "untitled"): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80);

  return slug || fallback;
}

export function normalizeProvider(value: AiProvider | string | null | undefined): AiProvider {
  return value === "openrouter" ? "openrouter" : "google";
}

export function normalizeThinkingLevel(value: ThinkingLevel | string | null | undefined): ThinkingLevel | null {
  if (value === null || value === undefined) {
    return null;
  }

  return ["none", "minimal", "low", "medium", "high", "xhigh"].includes(value) ? (value as ThinkingLevel) : null;
}

export function normalizeAccessLevel(value: AccessLevel | string | null | undefined): AccessLevel {
  return value === "loggedin" ? "loggedin" : "public";
}

function normalizeChunkText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}
