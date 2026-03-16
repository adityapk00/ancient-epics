import type {
  AdminBookSourcePayload,
  AdminBootstrapPayload,
  AdminSessionPayload,
  AdminTranslationDetail,
  AdminTranslationSummary,
  AdminTranslationValidationPayload,
  AiProvider,
  AuthSessionPayload,
  ApiResponse,
  BookDetail,
  BookSummary,
  ReaderChapterPayload,
  SourceChapterInput,
  ThinkingLevel,
  TranslationDraftArchive,
} from "@ancient-epics/shared";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: "include",
    ...init,
  });
  const payload = (await response.json()) as ApiResponse<T>;

  if (!payload.ok) {
    throw new ApiError(payload.error.message, response.status, payload.error.code);
  }

  if (!response.ok) {
    throw new ApiError(`Request failed with status ${response.status}`, response.status, "http_error");
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

function requestWithMethod<T>(method: "DELETE" | "POST", path: string): Promise<T> {
  return request<T>(path, {
    method,
  });
}

export const api = {
  health: () => request<{ environment: string; now: string }>("/api/health"),
  getAuthSession: () => request<AuthSessionPayload>("/api/auth/session"),
  signup: (body: { email: string; password: string }) =>
    requestJson<AuthSessionPayload>("POST", "/api/auth/signup", body),
  login: (body: { email: string; password: string }) =>
    requestJson<AuthSessionPayload>("POST", "/api/auth/login", body),
  logout: () => requestWithMethod<AuthSessionPayload>("POST", "/api/auth/logout"),
  getAdminSession: () => request<AdminSessionPayload>("/api/admin/session"),
  loginAdmin: (body: { password: string }) => requestJson<AdminSessionPayload>("POST", "/api/admin/login", body),
  logoutAdmin: () => requestWithMethod<AdminSessionPayload>("POST", "/api/admin/logout"),
  listBooks: () => request<{ books: BookSummary[] }>("/api/books"),
  getBook: (bookSlug: string) => request<BookDetail>(`/api/books/${bookSlug}`),
  getChapter: (bookSlug: string, chapterSlug: string, translationSlug?: string | null) =>
    request<ReaderChapterPayload>(
      `/api/books/${bookSlug}/chapters/${chapterSlug}${
        translationSlug ? `?translation=${encodeURIComponent(translationSlug)}` : ""
      }`,
    ),
  getAdminSettings: () => request<{ settings: Record<string, string> }>("/api/admin/settings"),
  updateAdminSettings: (settings: Record<string, string>) =>
    requestJson<{ updated: string[] }>("PUT", "/api/admin/settings", {
      settings,
    }),
  getAdminBootstrap: () => request<AdminBootstrapPayload>("/api/admin/bootstrap"),
  createAdminBook: (body: {
    title: string;
    author?: string;
    originalLanguage?: string;
    description?: string;
    chapters: SourceChapterInput[];
  }) => requestJson<AdminBookSourcePayload>("POST", "/api/admin/books", body),
  getAdminBook: (bookSlug: string) => request<AdminBookSourcePayload>(`/api/admin/books/${bookSlug}`),
  getAdminBookSource: (bookSlug: string) => request<AdminBookSourcePayload>(`/api/admin/books/${bookSlug}/source`),
  updateAdminBook: (
    bookSlug: string,
    body: {
      title?: string;
      author?: string;
      originalLanguage?: string;
      description?: string;
    },
  ) => requestJson<AdminBookSourcePayload>("PUT", `/api/admin/books/${bookSlug}`, body),
  deleteAdminBook: (bookSlug: string) =>
    requestWithMethod<{ deleted: true; bookSlug: string }>("DELETE", `/api/admin/books/${bookSlug}`),
  listAdminTranslations: (bookSlug: string) =>
    request<{ translations: AdminTranslationSummary[] }>(`/api/admin/books/${bookSlug}/translations`),
  createAdminTranslation: (
    bookSlug: string,
    body: {
      title: string;
      description?: string;
      accessLevel?: "public" | "loggedin";
      provider: AiProvider;
      model: string;
      thinkingLevel?: ThinkingLevel | null;
      prompt: string;
      contextBeforeChapterCount?: number;
      contextAfterChapterCount?: number;
    },
  ) => requestJson<AdminTranslationDetail>("POST", `/api/admin/books/${bookSlug}/translations`, body),
  importAdminTranslation: (bookSlug: string, body: { archive: TranslationDraftArchive | unknown }) =>
    requestJson<AdminTranslationDetail>("POST", `/api/admin/books/${bookSlug}/translations/import`, body),
  getAdminTranslation: (translationId: string) =>
    request<AdminTranslationDetail>(`/api/admin/translations/${translationId}`),
  updateAdminTranslation: (
    translationId: string,
    body: {
      name?: string;
      slug?: string;
      description?: string;
      accessLevel?: "public" | "loggedin";
      provider?: AiProvider;
      model?: string;
      thinkingLevel?: ThinkingLevel | null;
      prompt?: string;
      contextBeforeChapterCount?: number;
      contextAfterChapterCount?: number;
    },
  ) => requestJson<AdminTranslationDetail>("PUT", `/api/admin/translations/${translationId}`, body),
  deleteAdminTranslation: (translationId: string) =>
    requestWithMethod<{ deleted: true; translationId: string }>("DELETE", `/api/admin/translations/${translationId}`),
  validateAdminTranslation: (translationId: string) =>
    request<AdminTranslationValidationPayload>(`/api/admin/translations/${translationId}/validate`),
  generateAdminTranslationChapter: (translationId: string, chapterId: string) =>
    requestJson<AdminTranslationDetail>(
      "POST",
      `/api/admin/translations/${translationId}/chapters/${chapterId}/generate`,
      {},
    ),
  saveAdminTranslationChapter: (translationId: string, chapterId: string, rawResponse: string) =>
    requestJson<AdminTranslationDetail>("PUT", `/api/admin/translations/${translationId}/chapters/${chapterId}`, {
      rawResponse,
    }),
  publishAdminTranslation: (translationId: string) =>
    requestWithMethod<AdminTranslationDetail>("POST", `/api/admin/translations/${translationId}/publish`),
  unpublishAdminTranslation: (translationId: string) =>
    requestWithMethod<AdminTranslationDetail>("POST", `/api/admin/translations/${translationId}/unpublish`),
};
