export type ChunkType = "prose" | "verse";

export type TranslationStatus = "draft" | "published";

export type TranslationChapterStatus = "empty" | "draft" | "saved" | "error";

export type AccessLevel = "public" | "loggedin";

export type ThinkingLevel = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type AiProvider = "google" | "openrouter";

export interface TranslationChunk {
  id: string;
  type: ChunkType;
  originalText: string;
  translatedText: string;
  ordinal: number;
}

export interface OriginalChapterDocument {
  bookSlug: string;
  chapterSlug: string;
  fullText: string;
}

export interface TranslationChapterDocument {
  translationSlug: string;
  chunks: TranslationChunk[];
}

export interface BookSummary {
  id: string;
  slug: string;
  title: string;
  author: string | null;
  originalLanguage: string | null;
  description: string | null;
  coverImageUrl: string | null;
  accessLevel: AccessLevel;
  publishedAt: string | null;
}

export interface ChapterSummary {
  id: string;
  slug: string;
  position: number;
  title: string;
}

export interface TranslationSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  accessLevel: AccessLevel;
  status: TranslationStatus;
  publishedAt: string | null;
  updatedAt: string;
}

export interface BookDetail extends BookSummary {
  chapters: ChapterSummary[];
  translations: TranslationSummary[];
}

export interface ReaderChapterPayload {
  book: Pick<BookSummary, "slug" | "title">;
  chapter: ChapterSummary;
  original: OriginalChapterDocument;
  availableTranslations: TranslationSummary[];
  translation: TranslationPayload | null;
}

export interface TranslationPayload {
  translation: TranslationSummary;
  content: TranslationChapterDocument;
}

export interface AppSetting {
  key: string;
  value: string;
  updatedAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface AuthSessionPayload {
  user: AuthUser | null;
}

export interface AdminSessionPayload {
  authenticated: boolean;
}

export const APP_SETTING_KEYS = {
  OPENROUTER_API_KEY: "openrouter_api_key",
  GOOGLE_API_KEY: "google_api_key",
  DEFAULT_PROVIDER: "default_provider",
  DEFAULT_MODEL: "default_model",
  DEFAULT_PROMPT: "default_prompt",
} as const;

export interface SourceChapterInput {
  position: number;
  title: string;
  slug: string;
  sourceText: string;
}

export interface AdminBookSourcePayload {
  book: BookDetail;
  chapters: SourceChapterInput[];
}

export interface AdminBookSummary extends BookSummary {
  chapterCount: number;
  translationCount: number;
  publishedTranslationCount: number;
  latestActivityAt: string | null;
}

export interface TranslationChapterDraft extends ChapterSummary {
  chapterId: string;
  sourceText: string;
  status: TranslationChapterStatus;
  rawResponse: string | null;
  content: TranslationChapterDocument | null;
  notes: string | null;
  errorMessage: string | null;
  updatedAt: string;
}

export interface AdminTranslationSummary extends TranslationSummary {
  bookSlug: string;
  provider: AiProvider;
  model: string;
  thinkingLevel: ThinkingLevel | null;
  contextBeforeChapterCount: number;
  contextAfterChapterCount: number;
  chapterCount: number;
  savedChapterCount: number;
  draftChapterCount: number;
  errorChapterCount: number;
  latestActivityAt: string | null;
}

export interface AdminTranslationDetail extends AdminTranslationSummary {
  prompt: string;
  chapters: TranslationChapterDraft[];
}

export interface AdminBootstrapPayload {
  books: AdminBookSummary[];
  settings: Record<string, string>;
}

export interface AdminTranslationValidationIssue {
  level: "error" | "warning";
  message: string;
  chapterId?: string;
  chapterPosition?: number;
  chapterSlug?: string;
  translationChunkId?: string;
}

export interface AdminTranslationValidationChapter {
  chapterId: string;
  position: number;
  title: string;
  slug: string;
  status: TranslationChapterStatus;
  issues: AdminTranslationValidationIssue[];
}

export interface AdminTranslationValidationPayload {
  translationId: string;
  isValid: boolean;
  issues: AdminTranslationValidationIssue[];
  chapters: AdminTranslationValidationChapter[];
}

export interface TranslationDraftArchive {
  version: 2;
  exportedAt: string;
  translation: {
    name: string;
    slug: string;
    description: string | null;
    accessLevel: AccessLevel;
    provider: AiProvider;
    model: string;
    thinkingLevel: ThinkingLevel | null;
    prompt: string;
    contextBeforeChapterCount: number;
    contextAfterChapterCount: number;
  };
  chapters: Array<{
    chapterSlug: string;
    position: number;
    title: string;
    status: TranslationChapterStatus;
    rawResponse: string | null;
    content: TranslationChapterDocument | null;
    notes: string | null;
  }>;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
