// ── Enum types ──────────────────────────────────────────────

export type ChunkType = "prose" | "verse";

/** Status for books and chapters. */
export type ContentStatus = "draft" | "published";

/** Status for translation variants (includes generation lifecycle). */
export type TranslationStatus = "draft" | "generating" | "ready" | "published" | "failed";

export type SubscriptionStatus = "free" | "trial" | "active" | "expired";

export type UserRole = "reader" | "admin";

export type AdminIngestionSourceMode = "paste" | "existing_story";

export type AdminIngestionChapterStatus = "pending" | "generated" | "saved" | "error";

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

export interface AdminBookWorkflowSummary extends BookSummary {
  chapterCount: number;
  translationCount: number;
  readyTranslationCount: number;
  savedChapterCount: number;
  latestActivityAt: string | null;
}

export type AdminTranslationSessionSummary = AdminIngestionSessionSummary;

export interface AdminTranslationSummary extends TranslationSummary {
  bookSlug: string;
  aiSystemPrompt: string | null;
  latestSession: AdminTranslationSessionSummary | null;
  sessionCount: number;
  chapterCount: number;
  savedChapterCount: number;
  generatedChapterCount: number;
  pendingChapterCount: number;
  latestActivityAt: string | null;
}

export interface AdminTranslationDetail extends AdminTranslationSummary {
  currentSession: AdminIngestionSessionDetail | null;
  sessions: AdminTranslationSessionSummary[];
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
  ADMIN_INGESTION_MODEL: "admin_ingestion_model",
  ADMIN_INGESTION_PROMPT: "admin_ingestion_prompt",
} as const;

// ── Admin ingestion workflow ────────────────────────────────

export interface AdminIngestionChapterInput {
  position: number;
  title: string;
  slug: string;
  sourceText: string;
  sourceChapterSlug: string | null;
}

export interface AdminIngestionSessionSummary {
  id: string;
  title: string;
  sourceMode: AdminIngestionSourceMode;
  sourceBookSlug: string | null;
  translationId: string | null;
  model: string;
  contextBeforeChapterCount: number;
  contextAfterChapterCount: number;
  currentChapterIndex: number;
  chapterCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminIngestionChapterRecord extends AdminIngestionChapterInput {
  id: string;
  status: AdminIngestionChapterStatus;
  rawResponse: string | null;
  originalDocument: OriginalChapterDocument | null;
  translationDocument: TranslationChapterDocument | null;
  notes: string | null;
  errorMessage: string | null;
  updatedAt: string;
}

export interface AdminIngestionSessionDetail extends AdminIngestionSessionSummary {
  prompt: string;
  chapters: AdminIngestionChapterRecord[];
}

export interface AdminIngestionBootstrapPayload {
  books: AdminBookWorkflowSummary[];
  settings: Record<string, string>;
  sessions: AdminIngestionSessionSummary[];
}

export interface AdminBookChapterInput {
  position: number;
  title: string;
  slug: string;
  sourceText: string;
}

export interface AdminBookSourcePayload {
  book: BookDetail;
  chapters: AdminBookChapterInput[];
}

export interface AdminTranslationValidationIssue {
  level: "error" | "warning";
  message: string;
  chapterPosition?: number;
  chapterSlug?: string;
  translationChunkId?: string;
  sourceChunkId?: string;
}

export interface AdminTranslationValidationChapter {
  position: number;
  title: string;
  slug: string;
  status: AdminIngestionChapterStatus;
  issues: AdminTranslationValidationIssue[];
}

export interface AdminTranslationValidationPayload {
  session: AdminIngestionSessionDetail;
  isValid: boolean;
  issues: AdminTranslationValidationIssue[];
  chapters: AdminTranslationValidationChapter[];
}

export interface AdminIngestionGeneratePayload {
  chapter: AdminIngestionChapterRecord;
  session: AdminIngestionSessionSummary & { prompt: string };
}

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
