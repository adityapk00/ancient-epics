export type ChunkType = "prose" | "verse";

export type TranslationStatus =
  | "draft"
  | "generating"
  | "ready"
  | "published"
  | "failed";

export type SubscriptionStatus = "free" | "trial" | "active" | "expired";

export type UserRole = "reader" | "admin";

export interface TextChunk {
  id: string;
  type: ChunkType;
  text: string;
  ordinal: number;
}

export interface OriginalChapterDocument {
  bookSlug: string;
  chapterSlug: string;
  chunks: TextChunk[];
}

export interface TranslationChapterDocument {
  translationSlug: string;
  chunks: Record<string, string>;
}

export interface BookSummary {
  id: string;
  slug: string;
  title: string;
  author: string | null;
  originalLanguage: string | null;
  description: string | null;
  coverImageUrl: string | null;
  isPublished: boolean;
  publishedAt: string | null;
}

export interface ChapterSummary {
  id: string;
  slug: string;
  position: number;
  title: string;
  isPreview: boolean;
  sourceR2Key: string;
  publishedAt: string | null;
}

export interface TranslationSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  outputR2Prefix: string;
  status: TranslationStatus;
  isPublished: boolean;
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
  chunkId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
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
