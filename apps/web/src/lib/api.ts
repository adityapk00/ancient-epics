import type {
  AiProvider,
  AdminBookChapterInput,
  AdminBookSourcePayload,
  AdminIngestionBootstrapPayload,
  AdminIngestionSessionDetail,
  AdminTranslationDetail,
  AdminTranslationSummary,
  AdminTranslationValidationPayload,
  ThinkingLevel,
  ApiResponse,
  BookDetail,
  BookSummary,
  ChapterPayload,
  TranslationPayload,
} from "@ancient-epics/shared";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, init);
  const payload = (await response.json()) as ApiResponse<T>;

  if (!payload.ok) {
    throw new Error(payload.error.message);
  }

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return payload.data;
}

function requestJson<T>(method: "POST" | "PUT", path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export const api = {
  health: () => request<{ environment: string; now: string }>("/api/health"),
  listBooks: () => request<{ books: BookSummary[] }>("/api/books"),
  getBook: (bookSlug: string) => request<BookDetail>(`/api/books/${bookSlug}`),
  getChapter: (bookSlug: string, chapterSlug: string) =>
    request<ChapterPayload>(`/api/books/${bookSlug}/chapters/${chapterSlug}`),
  getTranslation: (bookSlug: string, chapterSlug: string, translationSlug: string) =>
    request<TranslationPayload>(`/api/books/${bookSlug}/chapters/${chapterSlug}/translations/${translationSlug}`),
  getAdminSettings: () => request<{ settings: Record<string, string> }>("/api/admin/settings"),
  updateAdminSettings: (settings: Record<string, string>) =>
    requestJson<{ updated: string[] }>("PUT", "/api/admin/settings", {
      settings,
    }),
  getAdminIngestionBootstrap: () => request<AdminIngestionBootstrapPayload>("/api/admin/ingestion/bootstrap"),
  createAdminBook: (body: {
    title: string;
    slug?: string;
    author?: string;
    originalLanguage?: string;
    description?: string;
    chapters: AdminBookChapterInput[];
  }) => requestJson<AdminBookSourcePayload>("POST", "/api/admin/books", body),
  getAdminBookSource: (bookSlug: string) => request<AdminBookSourcePayload>(`/api/admin/books/${bookSlug}/source`),
  listAdminTranslations: (bookSlug: string) =>
    request<{ translations: AdminTranslationSummary[] }>(`/api/admin/books/${bookSlug}/translations`),
  createAdminTranslation: (
    bookSlug: string,
    body: {
      title: string;
      slug?: string;
      description?: string;
      provider: AiProvider;
      model: string;
      thinkingLevel?: ThinkingLevel | null;
      prompt: string;
      contextBeforeChapterCount?: number;
      contextAfterChapterCount?: number;
    },
  ) => requestJson<AdminTranslationDetail>("POST", `/api/admin/books/${bookSlug}/translations`, body),
  getAdminTranslation: (translationId: string) =>
    request<AdminTranslationDetail>(`/api/admin/translations/${translationId}`),
  updateAdminTranslation: (
    translationId: string,
    body: {
      name?: string;
      slug?: string;
      description?: string;
      status?: "draft" | "generating" | "ready" | "published" | "failed";
      provider?: AiProvider;
      model?: string;
      thinkingLevel?: ThinkingLevel | null;
      prompt?: string;
      contextBeforeChapterCount?: number;
      contextAfterChapterCount?: number;
      currentChapterIndex?: number;
    },
  ) => requestJson<AdminTranslationDetail>("PUT", `/api/admin/translations/${translationId}`, body),
  validateAdminTranslation: (translationId: string) =>
    request<AdminTranslationValidationPayload>(`/api/admin/translations/${translationId}/validate`),
  createAdminIngestionSession: (body: {
    title: string;
    sourceMode: "paste" | "existing_story";
    sourceBookSlug?: string;
    translationId?: string;
    provider: AiProvider;
    model: string;
    thinkingLevel?: ThinkingLevel | null;
    prompt: string;
    contextBeforeChapterCount?: number;
    contextAfterChapterCount?: number;
    chapters?: Array<{
      position: number;
      title: string;
      slug: string;
      sourceText: string;
      sourceChapterSlug: string | null;
    }>;
  }) => requestJson<AdminIngestionSessionDetail>("POST", "/api/admin/ingestion/sessions", body),
  getAdminIngestionSession: (sessionId: string) =>
    request<AdminIngestionSessionDetail>(`/api/admin/ingestion/sessions/${sessionId}`),
  updateAdminIngestionSession: (
    sessionId: string,
    body: {
      title?: string;
      provider?: AiProvider;
      model?: string;
      thinkingLevel?: ThinkingLevel | null;
      prompt?: string;
      contextBeforeChapterCount?: number;
      contextAfterChapterCount?: number;
      currentChapterIndex?: number;
    },
  ) => requestJson<AdminIngestionSessionDetail>("PUT", `/api/admin/ingestion/sessions/${sessionId}`, body),
  generateAdminIngestionChapter: (sessionId: string, position: number) =>
    requestJson<{ chapter: AdminIngestionSessionDetail["chapters"][number] }>(
      "POST",
      `/api/admin/ingestion/sessions/${sessionId}/chapters/${position}/generate`,
      {},
    ),
  saveAdminIngestionChapter: (sessionId: string, position: number, rawResponse: string) =>
    requestJson<{
      chapter: AdminIngestionSessionDetail["chapters"][number];
      session: AdminIngestionSessionDetail | null;
    }>("PUT", `/api/admin/ingestion/sessions/${sessionId}/chapters/${position}/save`, {
      rawResponse,
    }),
};
