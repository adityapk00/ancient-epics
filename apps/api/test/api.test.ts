import type {
  AdminBookSourcePayload,
  AdminTranslationDetail,
  AdminTranslationValidationPayload,
  ApiFailure,
  ApiResponse,
  ApiSuccess,
  BookDetail,
  BookSummary,
  OriginalChapterDocument,
  ReaderChapterPayload,
  TranslationChapterDocument,
  TranslationDraftArchive,
  TranslationPayload,
  TranslationSummary,
} from "@ancient-epics/shared";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createApiTestContext, type ApiTestContext } from "./support/api-test-harness";

const contexts: ApiTestContext[] = [];
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const seedRoot = path.resolve(__dirname, "..", "seed", "r2");

afterEach(() => {
  while (contexts.length > 0) {
    contexts.pop()?.close();
  }
});

describe("Ancient Epics API", () => {
  it("serves the seeded public and admin read APIs with the expected data", async () => {
    const ctx = await setupContext();

    const health = expectSuccess(await api<{ environment: string; now: string }>(ctx, "GET", "/api/health"));
    expect(health.environment).toBe("test");
    expect(health.now).toEqual(expect.any(String));

    const publicBooks = expectSuccess<{ books: BookSummary[] }>(await api(ctx, "GET", "/api/books"));
    expect(publicBooks.books).toEqual([
      expect.objectContaining({
        slug: "iliad",
        title: "The Iliad",
        author: "Attributed to Homer",
      }),
    ]);

    const bookDetail = expectSuccess<BookDetail>(await api(ctx, "GET", "/api/books/iliad"));
    expect(bookDetail.title).toBe("The Iliad");
    expect(bookDetail.chapters).toHaveLength(1);
    expect(bookDetail.translations).toEqual([
      expect.objectContaining({
        slug: "verse-meaning",
        status: "published",
      }),
    ]);

    const expectedOriginal = loadSeedJson<OriginalChapterDocument>("epics/iliad/book-1-the-rage/original.json");
    const expectedTranslation = loadSeedJson<TranslationChapterDocument>(
      "epics/iliad/book-1-the-rage/translations/verse-meaning.json",
    );

    const chapterDetail = expectSuccess<ReaderChapterPayload>(
      await api(ctx, "GET", "/api/books/iliad/chapters/book-1-the-rage?translation=verse-meaning"),
    );
    expect(chapterDetail.chapter.slug).toBe("book-1-the-rage");
    expect(chapterDetail.original).toEqual(expectedOriginal);
    expect(chapterDetail.availableTranslations).toEqual([
      expect.objectContaining({
        slug: "verse-meaning",
        status: "published",
      }),
    ]);
    expect(chapterDetail.translation?.content).toEqual(expectedTranslation);

    const translationDetail = expectSuccess<TranslationPayload>(
      await api(ctx, "GET", "/api/books/iliad/chapters/book-1-the-rage/translations/verse-meaning"),
    );
    expect(translationDetail.translation).toEqual(
      expect.objectContaining({
        slug: "verse-meaning",
        name: "Verse / Preserve Meaning",
        status: "published",
      }),
    );
    expect(translationDetail.content).toEqual(expectedTranslation);

    const adminBooks = expectSuccess<{ books: BookSummary[] }>(await api(ctx, "GET", "/api/admin/books"));
    expect(adminBooks.books.some((book) => book.slug === "iliad")).toBe(true);

    const adminBook = expectSuccess<AdminBookSourcePayload>(await api(ctx, "GET", "/api/admin/books/iliad"));
    expect(adminBook.book.slug).toBe("iliad");
    expect(adminBook.book.translations).toHaveLength(1);
    expect(adminBook.chapters).toEqual([
      expect.objectContaining({
        slug: "book-1-the-rage",
        sourceText: expectedOriginal.fullText,
      }),
    ]);

    const adminTranslations = expectSuccess<{ translations: TranslationSummary[] }>(
      await api(ctx, "GET", "/api/admin/books/iliad/translations"),
    );
    expect(adminTranslations.translations).toEqual([
      expect.objectContaining({
        slug: "verse-meaning",
        status: "published",
      }),
    ]);
  });

  it("supports book CRUD and translation save, publish, and unpublish through the API", async () => {
    const ctx = await setupContext();

    const createdBook = expectSuccess<AdminBookSourcePayload>(
      await api(ctx, "POST", "/api/admin/books", {
        title: "Lifecycle Book",
        author: "Test Author",
        originalLanguage: "Akkadian",
        description: "Created by the API test suite.",
        chapters: [
          {
            position: 1,
            title: "Tablet One",
            slug: "tablet-one",
            sourceText: "First line of tablet one.\nSecond line of tablet one.",
          },
          {
            position: 2,
            title: "Tablet Two",
            slug: "tablet-two",
            sourceText: "First line of tablet two.",
          },
        ],
      }),
      201,
    );
    expect(createdBook.book.slug).toBe("lifecycle-book");
    expect(createdBook.book.translations).toEqual([]);
    expect(createdBook.chapters).toHaveLength(2);

    const updatedBook = expectSuccess<AdminBookSourcePayload>(
      await api(ctx, "PUT", "/api/admin/books/lifecycle-book", {
        title: "Lifecycle Book Revised",
        author: "Edited Author",
        originalLanguage: "Sumerian",
        description: "Updated book metadata.",
      }),
    );
    expect(updatedBook.book).toEqual(
      expect.objectContaining({
        slug: "lifecycle-book",
        title: "Lifecycle Book Revised",
        author: "Edited Author",
        originalLanguage: "Sumerian",
        description: "Updated book metadata.",
      }),
    );

    const createdTranslation = expectSuccess<AdminTranslationDetail>(
      await api(ctx, "POST", "/api/admin/books/lifecycle-book/translations", {
        title: "Working Translation",
        description: "Initial translation draft.",
        provider: "google",
        model: "test-model-v1",
        prompt: "Return JSON only.",
        contextBeforeChapterCount: 1,
        contextAfterChapterCount: 0,
      }),
      201,
    );
    expect(createdTranslation.slug).toBe("working-translation");
    expect(createdTranslation.status).toBe("draft");
    expect(createdTranslation.chapters).toHaveLength(2);

    const savedTranslation = await saveTranslationChapters(ctx, createdTranslation, {
      "tablet-one": "Translated tablet one.\nKept as verse.",
      "tablet-two": "Translated tablet two.",
    });
    expect(savedTranslation.savedChapterCount).toBe(2);
    expect(savedTranslation.chapters.every((chapter) => chapter.status === "saved")).toBe(true);

    const validation = expectSuccess<AdminTranslationValidationPayload>(
      await api(ctx, "GET", `/api/admin/translations/${createdTranslation.id}/validate`),
    );
    expect(validation.isValid).toBe(true);
    expect(validation.issues).toEqual([]);

    const editedTranslation = expectSuccess<AdminTranslationDetail>(
      await api(ctx, "PUT", `/api/admin/translations/${createdTranslation.id}`, {
        name: "Annotated Translation",
        slug: "annotated-translation",
        description: "Edited translation metadata.",
        provider: "openrouter",
        model: "openrouter/test-model-v2",
        thinkingLevel: "medium",
        prompt: "Return compact JSON only.",
        contextBeforeChapterCount: 0,
        contextAfterChapterCount: 1,
      }),
    );
    expect(editedTranslation).toEqual(
      expect.objectContaining({
        slug: "annotated-translation",
        name: "Annotated Translation",
        description: "Edited translation metadata.",
        provider: "openrouter",
        model: "openrouter/test-model-v2",
        thinkingLevel: "medium",
        prompt: "Return compact JSON only.",
        contextBeforeChapterCount: 0,
        contextAfterChapterCount: 1,
      }),
    );

    const publishedTranslation = expectSuccess<AdminTranslationDetail>(
      await api(ctx, "POST", `/api/admin/translations/${createdTranslation.id}/publish`, {}),
    );
    expect(publishedTranslation.status).toBe("published");

    const publicBooksAfterPublish = expectSuccess<{ books: BookSummary[] }>(await api(ctx, "GET", "/api/books"));
    expect(publicBooksAfterPublish.books.some((book) => book.slug === "lifecycle-book")).toBe(true);

    const publicBookDetail = expectSuccess<BookDetail>(await api(ctx, "GET", "/api/books/lifecycle-book"));
    expect(publicBookDetail).toEqual(
      expect.objectContaining({
        slug: "lifecycle-book",
        title: "Lifecycle Book Revised",
        author: "Edited Author",
        originalLanguage: "Sumerian",
      }),
    );
    expect(publicBookDetail.chapters.map((chapter) => chapter.slug)).toEqual(["tablet-one", "tablet-two"]);
    expect(publicBookDetail.translations).toEqual([
      expect.objectContaining({
        slug: "annotated-translation",
        status: "published",
      }),
    ]);

    const publicChapter = expectSuccess<ReaderChapterPayload>(
      await api(ctx, "GET", "/api/books/lifecycle-book/chapters/tablet-one?translation=annotated-translation"),
    );
    expect(publicChapter.original.fullText).toBe("First line of tablet one.\nSecond line of tablet one.");
    expect(publicChapter.translation?.content).toEqual({
      translationSlug: "annotated-translation",
      chunks: [
        {
          id: "t1",
          ordinal: 1,
          originalText: "First line of tablet one.\nSecond line of tablet one.",
          translatedText: "Translated tablet one.\nKept as verse.",
          type: "verse",
        },
      ],
    });

    const publicTranslation = expectSuccess<TranslationPayload>(
      await api(ctx, "GET", "/api/books/lifecycle-book/chapters/tablet-one/translations/annotated-translation"),
    );
    expect(publicTranslation.translation.status).toBe("published");

    const unpublishedTranslation = expectSuccess<AdminTranslationDetail>(
      await api(ctx, "POST", `/api/admin/translations/${createdTranslation.id}/unpublish`, {}),
    );
    expect(unpublishedTranslation.status).toBe("draft");

    const publicBooksAfterUnpublish = expectSuccess<{ books: BookSummary[] }>(await api(ctx, "GET", "/api/books"));
    expect(publicBooksAfterUnpublish.books.some((book) => book.slug === "lifecycle-book")).toBe(false);

    const missingBook = expectFailure(await api(ctx, "GET", "/api/books/lifecycle-book"), 404);
    expect(missingBook.code).toBe("not_found");

    const deletedBook = expectSuccess<{ deleted: boolean; bookSlug: string }>(
      await api(ctx, "DELETE", "/api/admin/books/lifecycle-book"),
    );
    expect(deletedBook).toEqual({
      deleted: true,
      bookSlug: "lifecycle-book",
    });

    const deletedBookLookup = expectFailure(await api(ctx, "GET", "/api/admin/books/lifecycle-book"), 404);
    expect(deletedBookLookup.code).toBe("not_found");

    const deletedTranslationLookup = expectFailure(
      await api(ctx, "GET", `/api/admin/translations/${createdTranslation.id}`),
      404,
    );
    expect(deletedTranslationLookup.code).toBe("not_found");
  });

  it("imports translations, publishes them, and supports translation deletion", async () => {
    const ctx = await setupContext();

    expectSuccess<AdminBookSourcePayload>(
      await api(ctx, "POST", "/api/admin/books", {
        title: "Imported Book",
        author: "Import Author",
        originalLanguage: "Latin",
        description: "Created for import testing.",
        chapters: [
          {
            position: 1,
            title: "Chapter One",
            slug: "chapter-one",
            sourceText: "Imported chapter source text.",
          },
        ],
      }),
      201,
    );

    const sourcePayload = expectSuccess<AdminBookSourcePayload>(
      await api(ctx, "GET", "/api/admin/books/imported-book"),
    );
    expect(sourcePayload.chapters).toHaveLength(1);

    const importedTranslation = expectSuccess<AdminTranslationDetail>(
      await api(ctx, "POST", "/api/admin/books/imported-book/translations/import", {
        archive: buildImportedArchive(sourcePayload, {
          "chapter-one": "Imported translation text.",
        }),
      }),
      201,
    );
    expect(importedTranslation.slug).toBe("imported-session");
    expect(importedTranslation.status).toBe("draft");
    expect(importedTranslation.chapters).toEqual([
      expect.objectContaining({
        slug: "chapter-one",
        status: "saved",
      }),
    ]);

    const validation = expectSuccess<AdminTranslationValidationPayload>(
      await api(ctx, "GET", `/api/admin/translations/${importedTranslation.id}/validate`),
    );
    expect(validation.isValid).toBe(true);

    const publishedTranslation = expectSuccess<AdminTranslationDetail>(
      await api(ctx, "POST", `/api/admin/translations/${importedTranslation.id}/publish`, {}),
    );
    expect(publishedTranslation.status).toBe("published");

    const publicBook = expectSuccess<BookDetail>(await api(ctx, "GET", "/api/books/imported-book"));
    expect(publicBook.translations).toEqual([
      expect.objectContaining({
        slug: "imported-session",
        status: "published",
      }),
    ]);

    const publicTranslation = expectSuccess<TranslationPayload>(
      await api(ctx, "GET", "/api/books/imported-book/chapters/chapter-one/translations/imported-session"),
    );
    expect(publicTranslation.content).toEqual({
      translationSlug: "imported-session",
      chunks: [
        {
          id: "t1",
          ordinal: 1,
          originalText: "Imported chapter source text.",
          translatedText: "Imported translation text.",
          type: "prose",
        },
      ],
    });

    const deletedTranslation = expectSuccess<{ deleted: boolean; translationId: string }>(
      await api(ctx, "DELETE", `/api/admin/translations/${importedTranslation.id}`),
    );
    expect(deletedTranslation).toEqual({
      deleted: true,
      translationId: importedTranslation.id,
    });

    const translationAfterDelete = expectFailure(
      await api(ctx, "GET", `/api/admin/translations/${importedTranslation.id}`),
      404,
    );
    expect(translationAfterDelete.code).toBe("not_found");

    const adminTranslationsAfterDelete = expectSuccess<{ translations: TranslationSummary[] }>(
      await api(ctx, "GET", "/api/admin/books/imported-book/translations"),
    );
    expect(adminTranslationsAfterDelete.translations).toEqual([]);

    expectSuccess<{ deleted: boolean; bookSlug: string }>(await api(ctx, "DELETE", "/api/admin/books/imported-book"));
  });
});

async function setupContext() {
  const context = await createApiTestContext();
  contexts.push(context);
  return context;
}

async function api<T>(ctx: ApiTestContext, method: string, urlPath: string, body?: unknown) {
  return ctx.request<ApiResponse<T>>(method, urlPath, body);
}

function expectSuccess<T>(response: { status: number; json: ApiResponse<T> }, expectedStatus = 200) {
  expect(response.status).toBe(expectedStatus);
  expect(response.json.ok).toBe(true);
  return (response.json as ApiSuccess<T>).data;
}

function expectFailure(response: { status: number; json: ApiResponse<never> }, expectedStatus: number) {
  expect(response.status).toBe(expectedStatus);
  expect(response.json.ok).toBe(false);
  return (response.json as ApiFailure).error;
}

function buildChapterRawResponse(
  chapter: Pick<AdminTranslationDetail["chapters"][number], "sourceText" | "title">,
  translatedText: string,
) {
  return JSON.stringify({
    chapterTitle: chapter.title,
    notes: `Saved by test for ${chapter.title}.`,
    chunks: [
      {
        originalText: chapter.sourceText,
        translatedText,
        type: chapter.sourceText.includes("\n") ? "verse" : "prose",
      },
    ],
  });
}

async function saveTranslationChapters(
  ctx: ApiTestContext,
  translation: AdminTranslationDetail,
  translatedTextBySlug: Record<string, string>,
) {
  let current = translation;

  for (const chapter of translation.chapters) {
    const translatedText = translatedTextBySlug[chapter.slug];
    expect(typeof translatedText).toBe("string");

    current = expectSuccess<AdminTranslationDetail>(
      await api(ctx, "PUT", `/api/admin/translations/${translation.id}/chapters/${chapter.chapterId}`, {
        rawResponse: buildChapterRawResponse(chapter, translatedText),
      }),
    );
  }

  return current;
}

function buildImportedArchive(sourcePayload: AdminBookSourcePayload, translatedTextBySlug: Record<string, string>) {
  const now = new Date().toISOString();

  return {
    version: 2,
    exportedAt: now,
    translation: {
      name: "Imported Session",
      slug: "imported-session",
      description: "Imported from test archive.",
      provider: "google",
      model: "test-import-model",
      thinkingLevel: null,
      prompt: "Return JSON only.",
      contextBeforeChapterCount: 0,
      contextAfterChapterCount: 0,
    },
    chapters: sourcePayload.chapters.map((chapter) => {
      const translatedText = translatedTextBySlug[chapter.slug];

      if (!translatedText) {
        throw new Error(`Missing imported translation text for chapter '${chapter.slug}'.`);
      }

      return {
        chapterSlug: chapter.slug,
        position: chapter.position,
        title: chapter.title,
        status: "saved" as const,
        rawResponse: JSON.stringify({
          chapterTitle: chapter.title,
          chunks: [
            {
              originalText: chapter.sourceText,
              translatedText,
              type: chapter.sourceText.includes("\n") ? "verse" : "prose",
            },
          ],
        }),
        content: null,
        notes: null,
      };
    }),
  } satisfies TranslationDraftArchive;
}

function loadSeedJson<T>(relativePath: string) {
  return JSON.parse(readFileSync(path.join(seedRoot, relativePath), "utf8")) as T;
}
