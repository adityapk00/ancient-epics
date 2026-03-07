// ── Enum types ──────────────────────────────────────────────

export type ChunkType = "prose" | "verse";

/** Status for books and chapters. */
export type ContentStatus = "draft" | "published";

/** Status for translation variants (includes generation lifecycle). */
export type TranslationStatus =
  | "draft"
  | "generating"
  | "ready"
  | "published"
  | "failed";

export type SubscriptionStatus = "free" | "trial" | "active" | "expired";

export type UserRole = "reader" | "admin";

// ── R2 document shapes ──────────────────────────────────────

export interface TextChunk {
  id: string;
  type: ChunkType;
  text: string;
  ordinal: number;
}

export interface TranslationChunk extends TextChunk {
  sourceChunkIds: string[];
}

export interface OriginalChapterDocument {
  bookSlug: string;
  chapterSlug: string;
  chunks: TextChunk[];
}

export interface TranslationChapterDocument {
  translationSlug: string;
  chunks: TranslationChunk[];
}

// ── D1 row / API shapes ────────────────────────────────────

export interface BookSummary {
  id: string;
  slug: string;
  title: string;
  author: string | null;
  originalLanguage: string | null;
  description: string | null;
  coverImageUrl: string | null;
  status: ContentStatus;
  publishedAt: string | null;
}

export interface ChapterSummary {
  id: string;
  slug: string;
  position: number;
  title: string;
  isPreview: boolean;
  sourceR2Key: string;
  status: ContentStatus;
  publishedAt: string | null;
}

export interface TranslationSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  outputR2Prefix: string;
  status: TranslationStatus;
}

export interface BookDetail extends BookSummary {
  chapters: ChapterSummary[];
  translations: TranslationSummary[];
}

export interface ChapterPayload {
  chapter: ChapterSummary;
  original: OriginalChapterDocument;
  availableTranslations: TranslationSummary[];
}

export interface TranslationPayload {
  translation: TranslationSummary;
  content: TranslationChapterDocument;
}

// ── User / Notes ────────────────────────────────────────────

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  subscriptionStatus: SubscriptionStatus;
  stripeCustomerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteRecord {
  id: string;
  userId: string;
  bookId: string;
  chapterId: string;
  translationId: string | null;
  anchorDocument: "original" | "translation";
  anchorId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// ── App Settings ────────────────────────────────────────────

export interface AppSetting {
  key: string;
  value: string;
  updatedAt: string;
}

/** Well-known setting keys stored in the `app_settings` table. */
export const APP_SETTING_KEYS = {
  OPENROUTER_API_KEY: "openrouter_api_key",
  DEFAULT_TRANSLATION_MODEL: "default_translation_model",
} as const;

// ── Export / Import shapes ──────────────────────────────────

/** Portable archive for an original text (book + chapters + R2 chunks). */
export interface BookExportArchive {
  version: 1;
  exportedAt: string;
  book: Omit<BookSummary, "status"> & { originalLanguage: string | null };
  chapters: Array<{
    meta: Omit<ChapterSummary, "status">;
    chunks: TextChunk[];
  }>;
}

/** Portable archive for a single translation variant. */
export interface TranslationExportArchive {
  version: 1;
  exportedAt: string;
  bookSlug: string;
  translation: Omit<TranslationSummary, "status"> & {
    aiSystemPrompt: string | null;
  };
  /** Keyed by chapterSlug. */
  chapters: Record<string, TranslationChapterDocument>;
}

// ── API response wrappers ───────────────────────────────────

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
