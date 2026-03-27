import {
  type AdminAnalyticsPayload,
  buildTranslationChapterKey,
  type AdminBookSourcePayload,
  type AdminSessionPayload,
  type AdminTranslationDetail,
  type AdminTranslationValidationPayload,
  type AuthSessionPayload,
  type ApiFailure,
  type ApiResponse,
  type ApiSuccess,
  type BookDetail,
  type BookSummary,
  type OriginalChapterDocument,
  type ReaderChapterPayload,
  type TranslationDraftArchive,
  type TranslationPayload,
  type TranslationSummary,
} from "@ancient-epics/shared";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { hashPasswordForStorage } from "../src/auth";
import { normalizeTranslationChapterRawResponse } from "../src/translation-generation";
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
    const adminCookie = await loginAdmin(ctx);

    const health = expectSuccess(await api<{ environment: string; now: string }>(ctx, "GET", "/api/health"));
    expect(health.environment).toBe("test");
    expect(health.now).toEqual(expect.any(String));

    const publicBooks = expectSuccess<{ books: BookSummary[] }>(await api(ctx, "GET", "/api/books"));
    expect(publicBooks.books).toEqual([
      expect.objectContaining({
        slug: "iliad",
        title: "The Iliad",
        author: "Attributed to Homer",
        accessLevel: "public",
      }),
    ]);

    const bookDetail = expectSuccess<BookDetail>(await api(ctx, "GET", "/api/books/iliad"));
    expect(bookDetail.title).toBe("The Iliad");
    expect(bookDetail.chapters).toHaveLength(1);
    expect(bookDetail.translations).toEqual([
      expect.objectContaining({
        slug: "verse-meaning",
        accessLevel: "public",
        status: "published",
      }),
    ]);

    const expectedOriginal = loadSeedJson<OriginalChapterDocument>("epics/iliad/book-1-the-rage/original.json");
    const expectedTranslation = normalizeTranslationChapterRawResponse({
      translationSlug: "verse-meaning",
      rawResponse: loadSeedRawText("epics/iliad/book-1-the-rage/translations/verse-meaning.json"),
    }).content;

    const chapterDetail = expectSuccess<ReaderChapterPayload>(
      await api(ctx, "GET", "/api/books/iliad/chapters/book-1-the-rage?translation=verse-meaning"),
    );
    expect(chapterDetail.chapter.slug).toBe("book-1-the-rage");
    expect(chapterDetail.original).toEqual(expectedOriginal);
    expect(chapterDetail.availableTranslations).toEqual([
      expect.objectContaining({
        slug: "verse-meaning",
        accessLevel: "public",
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
        accessLevel: "public",
        name: "Verse / Preserve Meaning",
        status: "published",
      }),
    );
    expect(translationDetail.content).toEqual(expectedTranslation);

    const adminBooks = expectSuccess<{ books: BookSummary[] }>(
      await adminApi(ctx, adminCookie, "GET", "/api/admin/books"),
    );
    expect(adminBooks.books.some((book) => book.slug === "iliad")).toBe(true);

    const adminBook = expectSuccess<AdminBookSourcePayload>(
      await adminApi(ctx, adminCookie, "GET", "/api/admin/books/iliad"),
    );
    expect(adminBook.book.slug).toBe("iliad");
    expect(adminBook.book.translations).toHaveLength(1);
    expect(adminBook.chapters).toEqual([
      expect.objectContaining({
        slug: "book-1-the-rage",
        sourceText: expectedOriginal.fullText,
      }),
    ]);

    const adminTranslations = expectSuccess<{ translations: TranslationSummary[] }>(
      await adminApi(ctx, adminCookie, "GET", "/api/admin/books/iliad/translations"),
    );
    expect(adminTranslations.translations).toEqual([
      expect.objectContaining({
        slug: "verse-meaning",
        accessLevel: "public",
        status: "published",
      }),
    ]);
  });

  it("supports signup, login, logout, and enforces public versus logged-in reader access", async () => {
    const ctx = await setupContext();
    const unauthorizedAdmin = expectFailure(await api(ctx, "GET", "/api/admin/books"), 401);
    expect(unauthorizedAdmin.code).toBe("admin_auth_required");
    const adminCookie = await loginAdmin(ctx);

    expectSuccess<AdminBookSourcePayload>(
      await adminApi(ctx, adminCookie, "POST", "/api/admin/books", {
        title: "Access Book",
        author: "Access Author",
        originalLanguage: "Greek",
        description: "Used to test free and account-required translations.",
        chapters: [
          {
            position: 1,
            title: "Chapter One",
            slug: "chapter-one",
            sourceText: "Access source text.",
          },
        ],
      }),
      201,
    );

    const publicTranslation = expectSuccess<AdminTranslationDetail>(
      await adminApi(ctx, adminCookie, "POST", "/api/admin/books/access-book/translations", {
        title: "Free Translation",
        description: "Free to read.",
        accessLevel: "public",
        provider: "google",
        model: "test-model-free",
        prompt: "Return JSON only.",
        contextBeforeChapterCount: 0,
        contextAfterChapterCount: 0,
      }),
      201,
    );

    await saveTranslationChapters(ctx, adminCookie, publicTranslation, {
      "chapter-one": "Public translation text.",
    });
    expectSuccess<AdminTranslationDetail>(
      await adminApi(ctx, adminCookie, "POST", `/api/admin/translations/${publicTranslation.id}/publish`, {}),
    );

    const premiumTranslation = expectSuccess<AdminTranslationDetail>(
      await adminApi(ctx, adminCookie, "POST", "/api/admin/books/access-book/translations", {
        title: "Members Translation",
        description: "Requires a free account.",
        accessLevel: "loggedin",
        provider: "google",
        model: "test-model-members",
        prompt: "Return JSON only.",
        contextBeforeChapterCount: 0,
        contextAfterChapterCount: 0,
      }),
      201,
    );

    await saveTranslationChapters(ctx, adminCookie, premiumTranslation, {
      "chapter-one": "Members-only translation text.",
    });
    expectSuccess<AdminTranslationDetail>(
      await adminApi(ctx, adminCookie, "POST", `/api/admin/translations/${premiumTranslation.id}/publish`, {}),
    );

    expectSuccess<AdminBookSourcePayload>(
      await adminApi(ctx, adminCookie, "POST", "/api/admin/books", {
        title: "Members Book",
        author: "Premium Author",
        originalLanguage: "Latin",
        description: "All translations require an account.",
        chapters: [
          {
            position: 1,
            title: "Locked Chapter",
            slug: "locked-chapter",
            sourceText: "Members-only source text.",
          },
        ],
      }),
      201,
    );

    const membersBookTranslation = expectSuccess<AdminTranslationDetail>(
      await adminApi(ctx, adminCookie, "POST", "/api/admin/books/members-book/translations", {
        title: "Locked Translation",
        description: "Requires login.",
        accessLevel: "loggedin",
        provider: "google",
        model: "test-model-locked",
        prompt: "Return JSON only.",
        contextBeforeChapterCount: 0,
        contextAfterChapterCount: 0,
      }),
      201,
    );

    await saveTranslationChapters(ctx, adminCookie, membersBookTranslation, {
      "locked-chapter": "Locked translation text.",
    });
    expectSuccess<AdminTranslationDetail>(
      await adminApi(ctx, adminCookie, "POST", `/api/admin/translations/${membersBookTranslation.id}/publish`, {}),
    );

    const guestBooks = expectSuccess<{ books: BookSummary[] }>(await api(ctx, "GET", "/api/books"));
    expect(guestBooks.books).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: "access-book", accessLevel: "public" }),
        expect.objectContaining({ slug: "members-book", accessLevel: "loggedin" }),
      ]),
    );

    const guestBook = expectSuccess<BookDetail>(await api(ctx, "GET", "/api/books/access-book"));
    expect(guestBook.accessLevel).toBe("public");
    expect(guestBook.translations).toEqual([
      expect.objectContaining({ slug: "free-translation", accessLevel: "public" }),
      expect.objectContaining({ slug: "members-translation", accessLevel: "loggedin" }),
    ]);

    const guestMembersBook = expectSuccess<BookDetail>(await api(ctx, "GET", "/api/books/members-book"));
    expect(guestMembersBook.accessLevel).toBe("loggedin");
    expect(guestMembersBook.translations).toEqual([
      expect.objectContaining({ slug: "locked-translation", accessLevel: "loggedin" }),
    ]);

    const guestPublicChapter = expectSuccess<ReaderChapterPayload>(
      await api(ctx, "GET", "/api/books/access-book/chapters/chapter-one?translation=free-translation"),
    );
    expect(guestPublicChapter.translation?.translation.accessLevel).toBe("public");

    const guestLockedChapter = expectFailure(
      await api(ctx, "GET", "/api/books/access-book/chapters/chapter-one?translation=members-translation"),
      401,
    );
    expect(guestLockedChapter.code).toBe("auth_required");

    const guestLockedTranslation = expectFailure(
      await api(ctx, "GET", "/api/books/members-book/chapters/locked-chapter/translations/locked-translation"),
      401,
    );
    expect(guestLockedTranslation.code).toBe("auth_required");

    const guestLockedOriginal = expectFailure(
      await api(ctx, "GET", "/api/books/members-book/chapters/locked-chapter"),
      401,
    );
    expect(guestLockedOriginal.code).toBe("auth_required");

    const signupResponse = await api<AuthSessionPayload>(ctx, "POST", "/api/auth/signup", {
      email: "reader@example.com",
      password: "strong-password-123",
    });
    const signupPayload = expectSuccess<AuthSessionPayload>(signupResponse, 201);
    expect(signupPayload.user?.email).toBe("reader@example.com");

    const authCookie = extractCookieHeader(signupResponse.headers);
    expect(authCookie).toContain("ancient_epics_session=");

    const currentSession = expectSuccess<AuthSessionPayload>(
      await api(ctx, "GET", "/api/auth/session", undefined, { headers: { Cookie: authCookie } }),
    );
    expect(currentSession.user?.email).toBe("reader@example.com");

    const authenticatedLockedChapter = expectSuccess<ReaderChapterPayload>(
      await api(ctx, "GET", "/api/books/access-book/chapters/chapter-one?translation=members-translation", undefined, {
        headers: { Cookie: authCookie },
      }),
    );
    expect(authenticatedLockedChapter.translation?.content.chunks[0]?.translatedText).toBe(
      "Members-only translation text.",
    );

    const authenticatedLockedTranslation = expectSuccess<TranslationPayload>(
      await api(
        ctx,
        "GET",
        "/api/books/members-book/chapters/locked-chapter/translations/locked-translation",
        undefined,
        {
          headers: { Cookie: authCookie },
        },
      ),
    );
    expect(authenticatedLockedTranslation.translation.accessLevel).toBe("loggedin");

    const logoutResponse = await api<AuthSessionPayload>(ctx, "POST", "/api/auth/logout", undefined, {
      headers: { Cookie: authCookie },
    });
    const logoutPayload = expectSuccess<AuthSessionPayload>(logoutResponse);
    expect(logoutPayload.user).toBeNull();

    const loginResponse = await api<AuthSessionPayload>(ctx, "POST", "/api/auth/login", {
      email: "reader@example.com",
      password: "strong-password-123",
    });
    const loginPayload = expectSuccess<AuthSessionPayload>(loginResponse);
    expect(loginPayload.user?.email).toBe("reader@example.com");

    const loginCookie = extractCookieHeader(loginResponse.headers);
    expect(loginCookie).toContain("ancient_epics_session=");
  });

  it("supports book CRUD and translation save, publish, and unpublish through the API", async () => {
    const ctx = await setupContext();
    const adminCookie = await loginAdmin(ctx);

    const createdBook = expectSuccess<AdminBookSourcePayload>(
      await adminApi(ctx, adminCookie, "POST", "/api/admin/books", {
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
      await adminApi(ctx, adminCookie, "PUT", "/api/admin/books/lifecycle-book", {
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
      await adminApi(ctx, adminCookie, "POST", "/api/admin/books/lifecycle-book/translations", {
        title: "Working Translation",
        description: "Initial translation draft.",
        accessLevel: "public",
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
    const initialRawResponses = {
      "tablet-one": buildChapterRawResponse(
        createdTranslation.chapters.find((chapter) => chapter.slug === "tablet-one")!,
        "Translated tablet one.\nKept as verse.",
      ),
      "tablet-two": buildChapterRawResponse(
        createdTranslation.chapters.find((chapter) => chapter.slug === "tablet-two")!,
        "Translated tablet two.",
      ),
    };

    const savedTranslation = await saveTranslationChapters(ctx, adminCookie, createdTranslation, {
      "tablet-one": "Translated tablet one.\nKept as verse.",
      "tablet-two": "Translated tablet two.",
    });
    expect(savedTranslation.savedChapterCount).toBe(2);
    expect(savedTranslation.chapters.every((chapter) => chapter.status === "saved")).toBe(true);
    expect(await readStoredTranslationRawResponse(ctx, "lifecycle-book", "tablet-one", "working-translation")).toBe(
      initialRawResponses["tablet-one"],
    );
    expect(await readStoredTranslationRawResponse(ctx, "lifecycle-book", "tablet-two", "working-translation")).toBe(
      initialRawResponses["tablet-two"],
    );
    expect(
      await getTranslationChapterMetadataRow(
        ctx,
        createdTranslation.id,
        createdTranslation.chapters.find((chapter) => chapter.slug === "tablet-one")!.chapterId,
      ),
    ).toEqual(
      expect.objectContaining({
        status: "saved",
        errorMessage: null,
      }),
    );

    const validation = expectSuccess<AdminTranslationValidationPayload>(
      await adminApi(ctx, adminCookie, "GET", `/api/admin/translations/${createdTranslation.id}/validate`),
    );
    expect(validation.isValid).toBe(true);
    expect(validation.issues).toEqual([]);

    const editedTranslation = expectSuccess<AdminTranslationDetail>(
      await adminApi(ctx, adminCookie, "PUT", `/api/admin/translations/${createdTranslation.id}`, {
        name: "Annotated Translation",
        slug: "annotated-translation",
        description: "Edited translation metadata.",
        accessLevel: "public",
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
        accessLevel: "public",
        provider: "openrouter",
        model: "openrouter/test-model-v2",
        thinkingLevel: "medium",
        prompt: "Return compact JSON only.",
        contextBeforeChapterCount: 0,
        contextAfterChapterCount: 1,
      }),
    );
    expect(
      await readStoredTranslationRawResponse(ctx, "lifecycle-book", "tablet-one", "working-translation"),
    ).toBeNull();
    expect(await readStoredTranslationRawResponse(ctx, "lifecycle-book", "tablet-one", "annotated-translation")).toBe(
      initialRawResponses["tablet-one"],
    );

    const publishedTranslation = expectSuccess<AdminTranslationDetail>(
      await adminApi(ctx, adminCookie, "POST", `/api/admin/translations/${createdTranslation.id}/publish`, {}),
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

    const revisedPublishedRawResponse = buildChapterRawResponse(
      editedTranslation.chapters.find((chapter) => chapter.slug === "tablet-one")!,
      "Revised tablet one while editing a published translation.",
    );
    const redraftedTranslation = expectSuccess<AdminTranslationDetail>(
      await adminApi(
        ctx,
        adminCookie,
        "PUT",
        `/api/admin/translations/${createdTranslation.id}/chapters/${
          editedTranslation.chapters.find((chapter) => chapter.slug === "tablet-one")!.chapterId
        }`,
        {
          rawResponse: revisedPublishedRawResponse,
        },
      ),
    );
    expect(redraftedTranslation.status).toBe("draft");
    expect(await readStoredTranslationRawResponse(ctx, "lifecycle-book", "tablet-one", "annotated-translation")).toBe(
      revisedPublishedRawResponse,
    );
    expect(expectFailure(await api(ctx, "GET", "/api/books/lifecycle-book"), 404).code).toBe("not_found");

    const republishedTranslation = expectSuccess<AdminTranslationDetail>(
      await adminApi(ctx, adminCookie, "POST", `/api/admin/translations/${createdTranslation.id}/publish`, {}),
    );
    expect(republishedTranslation.status).toBe("published");
    expect(
      expectSuccess<TranslationPayload>(
        await api(ctx, "GET", "/api/books/lifecycle-book/chapters/tablet-one/translations/annotated-translation"),
      ).content.chunks[0]?.translatedText,
    ).toBe("Revised tablet one while editing a published translation.");

    const unpublishedTranslation = expectSuccess<AdminTranslationDetail>(
      await adminApi(ctx, adminCookie, "POST", `/api/admin/translations/${createdTranslation.id}/unpublish`, {}),
    );
    expect(unpublishedTranslation.status).toBe("draft");
    expect(await readStoredTranslationRawResponse(ctx, "lifecycle-book", "tablet-one", "annotated-translation")).toBe(
      revisedPublishedRawResponse,
    );

    const publicBooksAfterUnpublish = expectSuccess<{ books: BookSummary[] }>(await api(ctx, "GET", "/api/books"));
    expect(publicBooksAfterUnpublish.books.some((book) => book.slug === "lifecycle-book")).toBe(false);

    const missingBook = expectFailure(await api(ctx, "GET", "/api/books/lifecycle-book"), 404);
    expect(missingBook.code).toBe("not_found");

    const deletedBook = expectSuccess<{ deleted: boolean; bookSlug: string }>(
      await adminApi(ctx, adminCookie, "DELETE", "/api/admin/books/lifecycle-book"),
    );
    expect(deletedBook).toEqual({
      deleted: true,
      bookSlug: "lifecycle-book",
    });

    const deletedBookLookup = expectFailure(
      await adminApi(ctx, adminCookie, "GET", "/api/admin/books/lifecycle-book"),
      404,
    );
    expect(deletedBookLookup.code).toBe("not_found");

    const deletedTranslationLookup = expectFailure(
      await adminApi(ctx, adminCookie, "GET", `/api/admin/translations/${createdTranslation.id}`),
      404,
    );
    expect(deletedTranslationLookup.code).toBe("not_found");
  });

  it("records reader analytics and exposes them through the admin analytics API", async () => {
    const ctx = await setupContext();
    const adminCookie = await loginAdmin(ctx);

    const signupResponse = await api<AuthSessionPayload>(ctx, "POST", "/api/auth/signup", {
      email: "analytics@example.com",
      password: "strong-password-123",
    });
    const signupPayload = expectSuccess<AuthSessionPayload>(signupResponse, 201);
    const authCookie = extractCookieHeader(signupResponse.headers);

    expect(signupPayload.user?.email).toBe("analytics@example.com");

    expectSuccess<BookDetail>(await api(ctx, "GET", "/api/books/iliad"));
    expectSuccess<ReaderChapterPayload>(
      await api(ctx, "GET", "/api/books/iliad/chapters/book-1-the-rage?translation=verse-meaning", undefined, {
        headers: { Cookie: authCookie },
      }),
    );
    expectSuccess<TranslationPayload>(
      await api(ctx, "GET", "/api/books/iliad/chapters/book-1-the-rage/translations/verse-meaning", undefined, {
        headers: { Cookie: authCookie },
      }),
    );

    const analytics = expectSuccess<AdminAnalyticsPayload>(
      await adminApi(ctx, adminCookie, "GET", "/api/admin/analytics?days=30"),
    );

    expect(analytics.overview.signups).toBe(1);
    expect(analytics.overview.bookViews).toBe(1);
    expect(analytics.overview.chapterViews).toBe(1);
    expect(analytics.overview.translationViews).toBe(2);
    expect(analytics.topCountries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          country: "LOCAL",
          signups: 1,
          bookViews: 1,
          chapterViews: 1,
          translationViews: 2,
        }),
      ]),
    );
    expect(analytics.topBooks).toEqual([
      expect.objectContaining({
        bookSlug: "iliad",
        title: "The Iliad",
        viewCount: 1,
      }),
    ]);
    expect(analytics.topTranslations).toEqual([
      expect.objectContaining({
        bookSlug: "iliad",
        translationSlug: "verse-meaning",
        translationName: "Verse / Preserve Meaning",
        viewCount: 2,
      }),
    ]);
    expect(
      analytics.daily.some(
        (day) => day.signups === 1 && day.bookViews === 1 && day.chapterViews === 1 && day.translationViews === 2,
      ),
    ).toBe(true);
  });

  it("imports translations, publishes them, and supports translation deletion", async () => {
    const ctx = await setupContext();
    const adminCookie = await loginAdmin(ctx);

    expectSuccess<AdminBookSourcePayload>(
      await adminApi(ctx, adminCookie, "POST", "/api/admin/books", {
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
      await adminApi(ctx, adminCookie, "GET", "/api/admin/books/imported-book"),
    );
    expect(sourcePayload.chapters).toHaveLength(1);

    const importedTranslation = expectSuccess<AdminTranslationDetail>(
      await adminApi(ctx, adminCookie, "POST", "/api/admin/books/imported-book/translations/import", {
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
      await adminApi(ctx, adminCookie, "GET", `/api/admin/translations/${importedTranslation.id}/validate`),
    );
    expect(validation.isValid).toBe(true);

    const publishedTranslation = expectSuccess<AdminTranslationDetail>(
      await adminApi(ctx, adminCookie, "POST", `/api/admin/translations/${importedTranslation.id}/publish`, {}),
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
      await adminApi(ctx, adminCookie, "DELETE", `/api/admin/translations/${importedTranslation.id}`),
    );
    expect(deletedTranslation).toEqual({
      deleted: true,
      translationId: importedTranslation.id,
    });

    const translationAfterDelete = expectFailure(
      await adminApi(ctx, adminCookie, "GET", `/api/admin/translations/${importedTranslation.id}`),
      404,
    );
    expect(translationAfterDelete.code).toBe("not_found");

    const adminTranslationsAfterDelete = expectSuccess<{ translations: TranslationSummary[] }>(
      await adminApi(ctx, adminCookie, "GET", "/api/admin/books/imported-book/translations"),
    );
    expect(adminTranslationsAfterDelete.translations).toEqual([]);

    expectSuccess<{ deleted: boolean; bookSlug: string }>(
      await adminApi(ctx, adminCookie, "DELETE", "/api/admin/books/imported-book"),
    );
  });
});

async function setupContext() {
  const context = await createApiTestContext();
  contexts.push(context);
  return context;
}

async function api<T>(
  ctx: ApiTestContext,
  method: string,
  urlPath: string,
  body?: unknown,
  options?: { headers?: Record<string, string> },
) {
  return ctx.request<ApiResponse<T>>(method, urlPath, body, options);
}

async function adminApi<T>(ctx: ApiTestContext, adminCookie: string, method: string, urlPath: string, body?: unknown) {
  return api<T>(ctx, method, urlPath, body, {
    headers: {
      Cookie: adminCookie,
    },
  });
}

function expectSuccess<T>(response: { status: number; json: ApiResponse<T>; headers?: Headers }, expectedStatus = 200) {
  expect(response.status).toBe(expectedStatus);
  expect(response.json.ok).toBe(true);
  return (response.json as ApiSuccess<T>).data;
}

function expectFailure(
  response: { status: number; json: ApiResponse<never>; headers?: Headers },
  expectedStatus: number,
) {
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
  adminCookie: string,
  translation: AdminTranslationDetail,
  translatedTextBySlug: Record<string, string>,
) {
  let current = translation;

  for (const chapter of translation.chapters) {
    const translatedText = translatedTextBySlug[chapter.slug];
    expect(typeof translatedText).toBe("string");

    current = expectSuccess<AdminTranslationDetail>(
      await adminApi(
        ctx,
        adminCookie,
        "PUT",
        `/api/admin/translations/${translation.id}/chapters/${chapter.chapterId}`,
        {
          rawResponse: buildChapterRawResponse(chapter, translatedText),
        },
      ),
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
      accessLevel: "public",
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

function loadSeedRawText(relativePath: string) {
  return readFileSync(path.join(seedRoot, relativePath), "utf8");
}

async function readStoredTranslationRawResponse(
  ctx: ApiTestContext,
  bookSlug: string,
  chapterSlug: string,
  translationSlug: string,
) {
  const object = await ctx.env.CONTENT_BUCKET.get(buildTranslationChapterKey(bookSlug, chapterSlug, translationSlug));
  return object ? await object.text() : null;
}

async function getTranslationChapterMetadataRow(
  ctx: ApiTestContext,
  translationId: string,
  chapterId: string,
): Promise<{
  status: string;
  errorMessage: string | null;
} | null> {
  return await ctx.env.DB.prepare(
    `
      SELECT
        status,
        error_message AS errorMessage
      FROM translation_chapters
      WHERE translation_id = ?
        AND chapter_id = ?
    `,
  )
    .bind(translationId, chapterId)
    .first<{
      status: string;
      errorMessage: string | null;
    }>();
}

function extractCookieHeader(headers: Headers): string {
  const cookie = headers.get("set-cookie");
  if (!cookie) {
    throw new Error("Missing Set-Cookie header.");
  }

  return cookie.split(";")[0] ?? cookie;
}

async function loginAdmin(ctx: ApiTestContext): Promise<string> {
  const password = "admin-password-123";
  const passwordHash = await hashPasswordForStorage(password);
  const now = new Date().toISOString();

  await ctx.env.DB.prepare(
    `
        INSERT INTO admin_credentials (id, password_hash, updated_at)
        VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          password_hash = excluded.password_hash,
          updated_at = excluded.updated_at
      `,
  )
    .bind(passwordHash, now)
    .run();

  const response = await api<AdminSessionPayload>(ctx, "POST", "/api/admin/login", { password });
  const payload = expectSuccess<AdminSessionPayload>(response);
  expect(payload.authenticated).toBe(true);
  return extractCookieHeader(response.headers);
}
