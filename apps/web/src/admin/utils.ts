import {
  normalizeChapterText,
  reconstructSourceTextFromChunks,
  type AccessLevel,
  type AdminTranslationDetail,
  type AiProvider,
  type TranslationChapterDraft,
  type TranslationDraftArchive,
} from "@ancient-epics/shared";

import { THINKING_LEVEL_OPTIONS } from "./forms";

export type ChapterEditorState = {
  chapterTitle: string;
  notes: string;
  chunks: Array<{
    originalText: string;
    translatedText: string;
    type: "prose" | "verse";
  }>;
};

export function buildChapterEditorState(chapter: TranslationChapterDraft): ChapterEditorState {
  if (chapter.rawResponse?.trim()) {
    try {
      return parseEditorStateFromRaw(chapter.rawResponse);
    } catch {
      // Fall back to structured content below.
    }
  }

  return {
    chapterTitle: chapter.title,
    notes: chapter.notes ?? "",
    chunks: (
      chapter.content?.chunks ?? [
        {
          originalText: chapter.sourceText,
          translatedText: "",
          type: chapter.sourceText.includes("\n") ? "verse" : "prose",
        },
      ]
    ).map((chunk) => ({
      originalText: chunk.originalText,
      translatedText: chunk.translatedText,
      type: chunk.type,
    })),
  };
}

export function parseEditorStateFromRaw(rawResponse: string): ChapterEditorState {
  const parsed = JSON.parse(rawResponse) as {
    chapterTitle?: string;
    notes?: string;
    chunks?: Array<{
      originalText?: string;
      translatedText?: string;
      type?: "prose" | "verse";
    }>;
  };

  const chunks: ChapterEditorState["chunks"] = (parsed.chunks ?? []).map((chunk) => ({
    originalText: chunk.originalText ?? "",
    translatedText: chunk.translatedText ?? "",
    type: chunk.type === "verse" ? "verse" : "prose",
  }));

  if (chunks.length === 0) {
    throw new Error("Raw JSON must include chunks.");
  }

  return {
    chapterTitle: parsed.chapterTitle ?? "Untitled Chapter",
    notes: parsed.notes ?? "",
    chunks,
  };
}

export function serializeEditorState(editor: ChapterEditorState) {
  return {
    chapterTitle: editor.chapterTitle,
    notes: editor.notes,
    chunks: editor.chunks.map((chunk) => ({
      originalText: chunk.originalText,
      translatedText: chunk.translatedText,
      type: chunk.type,
    })),
  };
}

export function normalizeThinkingLevelValue(
  value: string,
): "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (THINKING_LEVEL_OPTIONS.some((option) => option.value === trimmed)) {
    return trimmed as "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  }

  return null;
}

export function formatThinkingSummary(
  translation:
    | {
        thinkingLevel: string | null;
      }
    | null
    | undefined,
): string {
  if (!translation?.thinkingLevel) {
    return "Thinking default";
  }

  if (translation.thinkingLevel === "none") {
    return "Thinking off";
  }

  return `Thinking ${translation.thinkingLevel}`;
}

export function formatProviderLabel(provider: AiProvider): string {
  return provider === "openrouter" ? "OpenRouter" : "Gemini SDK";
}

export function formatAccessLevelLabel(accessLevel: AccessLevel): string {
  return accessLevel === "loggedin" ? "Login Required" : "Free To Read";
}

export function buildTranslationArchive(activeTranslation: AdminTranslationDetail): TranslationDraftArchive {
  return {
    exportedAt: new Date().toISOString(),
    translation: {
      name: activeTranslation.name,
      slug: activeTranslation.slug,
      description: activeTranslation.description,
      accessLevel: activeTranslation.accessLevel,
      provider: activeTranslation.provider,
      model: activeTranslation.model,
      thinkingLevel: activeTranslation.thinkingLevel,
      prompt: activeTranslation.prompt,
      contextBeforeChapterCount: activeTranslation.contextBeforeChapterCount,
      contextAfterChapterCount: activeTranslation.contextAfterChapterCount,
    },
    chapters: activeTranslation.chapters.map((chapter) => ({
      chapterSlug: chapter.slug,
      position: chapter.position,
      title: chapter.title,
      status: chapter.status,
      rawResponse: chapter.rawResponse,
      content: chapter.content,
      notes: chapter.notes,
    })),
  };
}

export function formatTimestamp(value: string | null) {
  if (!value) {
    return "No activity";
  }

  return new Date(value).toLocaleDateString();
}

export function getBookPublicationStatus(publishedTranslationCount: number) {
  return publishedTranslationCount > 0 ? "published" : "draft";
}

export function getSourceReconstructionMatches(
  currentWorkspaceChapter: TranslationChapterDraft | null,
  chapterEditor: ChapterEditorState | null,
) {
  if (!currentWorkspaceChapter || !chapterEditor) {
    return true;
  }

  return (
    normalizeChapterText(currentWorkspaceChapter.sourceText) ===
    normalizeChapterText(reconstructSourceTextFromChunks(chapterEditor.chunks))
  );
}
