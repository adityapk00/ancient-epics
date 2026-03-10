import type { TranslationChunk } from "./types";

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

function normalizeChunkText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}
