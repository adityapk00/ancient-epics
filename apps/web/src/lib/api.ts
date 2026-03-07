import type {
  ApiResponse,
  BookDetail,
  BookSummary,
  ChapterPayload,
  TranslationPayload,
} from "@ancient-epics/shared";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as ApiResponse<T>;

  if (!payload.ok) {
    throw new Error(payload.error.message);
  }

  return payload.data;
}

export const api = {
  health: () => request<{ environment: string; now: string }>("/api/health"),
  listBooks: () => request<{ books: BookSummary[] }>("/api/books"),
  getBook: (bookSlug: string) => request<BookDetail>(`/api/books/${bookSlug}`),
  getChapter: (bookSlug: string, chapterSlug: string) =>
    request<ChapterPayload>(`/api/books/${bookSlug}/chapters/${chapterSlug}`),
  getTranslation: (
    bookSlug: string,
    chapterSlug: string,
    translationSlug: string,
  ) =>
    request<TranslationPayload>(
      `/api/books/${bookSlug}/chapters/${chapterSlug}/translations/${translationSlug}`,
    ),
};
