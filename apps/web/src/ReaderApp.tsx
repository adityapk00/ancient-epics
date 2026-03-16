import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import type {
  AccessLevel,
  AuthUser,
  BookDetail,
  BookSummary,
  ReaderChapterPayload,
  TranslationSummary,
} from "@ancient-epics/shared";

import { api, ApiError } from "./lib/api";

type ReaderScreen = "books" | "translations" | "reader";
type ReaderLoadState = "idle" | "loading" | "ready" | "error";
type AuthMode = "signup" | "login";
type ProtectedIntent =
  | { kind: "book"; bookSlug: string }
  | { kind: "translation"; bookSlug: string; translationSlug: string }
  | null;

function buildLastReadStorageKey(bookSlug: string, translationSlug: string): string {
  return `ancient-epics:last-read:${bookSlug}:${translationSlug}`;
}

function getStoredLastReadChapter(bookSlug: string, translationSlug: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(buildLastReadStorageKey(bookSlug, translationSlug));
}

function setStoredLastReadChapter(bookSlug: string, translationSlug: string, chapterSlug: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(buildLastReadStorageKey(bookSlug, translationSlug), chapterSlug);
}

export default function ReaderApp() {
  const [screen, setScreen] = useState<ReaderScreen>("books");
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>("signup");
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authPromptMessage, setAuthPromptMessage] = useState<string | null>(null);
  const [pendingProtectedIntent, setPendingProtectedIntent] = useState<ProtectedIntent>(null);
  const [pendingTranslationAfterAuth, setPendingTranslationAfterAuth] = useState<{
    bookSlug: string;
    translationSlug: string;
  } | null>(null);
  const [selectedBookSlug, setSelectedBookSlug] = useState<string | null>(null);
  const [selectedBook, setSelectedBook] = useState<BookDetail | null>(null);
  const [selectedTranslationSlug, setSelectedTranslationSlug] = useState<string | null>(null);
  const [selectedChapterSlug, setSelectedChapterSlug] = useState<string | null>(null);
  const [chapterPayload, setChapterPayload] = useState<ReaderChapterPayload | null>(null);
  const [isLoadingBooks, setIsLoadingBooks] = useState(true);
  const [isLoadingBook, setIsLoadingBook] = useState(false);
  const [isLoadingReader, setIsLoadingReader] = useState(false);
  const [readerLoadState, setReaderLoadState] = useState<ReaderLoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [translationUnavailableMessage, setTranslationUnavailableMessage] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function loadAuthSession() {
      try {
        const payload = await api.getAuthSession();
        if (isCancelled) {
          return;
        }

        setAuthUser(payload.user);
      } catch (loadError) {
        if (!isCancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load session.");
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingSession(false);
        }
      }
    }

    void loadAuthSession();
    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function loadBooks() {
      setIsLoadingBooks(true);
      setError(null);

      try {
        const payload = await api.listBooks();
        if (isCancelled) {
          return;
        }
        setBooks(payload.books);
      } catch (loadError) {
        if (!isCancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load books.");
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingBooks(false);
        }
      }
    }

    void loadBooks();
    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedBookSlug) {
      setSelectedBook(null);
      setSelectedTranslationSlug(null);
      setSelectedChapterSlug(null);
      setChapterPayload(null);
      return;
    }

    const bookSlug = selectedBookSlug;
    let isCancelled = false;

    async function loadBook() {
      setIsLoadingBook(true);
      setError(null);

      try {
        const payload = await api.getBook(bookSlug);
        if (isCancelled) {
          return;
        }
        setSelectedBook(payload);
      } catch (loadError) {
        if (!isCancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load book.");
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingBook(false);
        }
      }
    }

    void loadBook();
    return () => {
      isCancelled = true;
    };
  }, [selectedBookSlug]);

  useEffect(() => {
    if (!selectedBook || !selectedTranslationSlug || !selectedChapterSlug) {
      setChapterPayload(null);
      setTranslationUnavailableMessage(null);
      setReaderLoadState("idle");
      return;
    }

    const bookSlug = selectedBook.slug;
    const chapterSlug = selectedChapterSlug;
    const translationSlug = selectedTranslationSlug;
    let isCancelled = false;

    async function loadReaderContent() {
      setIsLoadingReader(true);
      setReaderLoadState("loading");
      setError(null);

      try {
        const chapter = await api.getChapter(bookSlug, chapterSlug, translationSlug);
        if (isCancelled) {
          return;
        }
        setChapterPayload(chapter);
        setTranslationUnavailableMessage(
          chapter.translation ? null : "This translation is not available for the selected chapter yet.",
        );
        setReaderLoadState("ready");
      } catch (loadError) {
        if (!isCancelled) {
          if (loadError instanceof ApiError && loadError.code === "auth_required") {
            setReaderLoadState("idle");
            openAuthDialog({
              mode: "signup",
              message: "Sign up for free to unlock this translation.",
              intent: { kind: "translation", bookSlug, translationSlug },
            });
            return;
          }

          setError(loadError instanceof Error ? loadError.message : "Failed to load reader content.");
          setReaderLoadState("error");
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingReader(false);
        }
      }
    }

    void loadReaderContent();
    return () => {
      isCancelled = true;
    };
  }, [selectedBook, selectedTranslationSlug, selectedChapterSlug]);

  useEffect(() => {
    if (!authUser || !pendingTranslationAfterAuth || selectedBook?.slug !== pendingTranslationAfterAuth.bookSlug) {
      return;
    }

    const translationSlug = pendingTranslationAfterAuth.translationSlug;
    const firstChapterSlug = selectedBook.chapters[0]?.slug ?? null;
    const storedChapterSlug = getStoredLastReadChapter(selectedBook.slug, translationSlug);
    const preferredChapterSlug =
      storedChapterSlug != null && selectedBook.chapters.some((chapter) => chapter.slug === storedChapterSlug)
        ? storedChapterSlug
        : firstChapterSlug;

    setPendingTranslationAfterAuth(null);
    setSelectedTranslationSlug(translationSlug);
    setSelectedChapterSlug(preferredChapterSlug);
    setChapterPayload(null);
    setReaderLoadState(preferredChapterSlug ? "loading" : "idle");
    setScreen("reader");
  }, [authUser, pendingTranslationAfterAuth, selectedBook]);

  useEffect(() => {
    if (!selectedBook || !selectedTranslationSlug || !selectedChapterSlug) {
      return;
    }

    setStoredLastReadChapter(selectedBook.slug, selectedTranslationSlug, selectedChapterSlug);
  }, [selectedBook, selectedTranslationSlug, selectedChapterSlug]);

  const selectedTranslation =
    selectedBook?.translations.find((translation) => translation.slug === selectedTranslationSlug) ?? null;
  const selectedChapter = selectedBook?.chapters.find((chapter) => chapter.slug === selectedChapterSlug) ?? null;
  const translationRows = chapterPayload?.translation?.content.chunks ?? [];
  const activeChapterTitle = chapterPayload?.chapter.title ?? selectedChapter?.title ?? "Chapter";
  const showReaderLoadingOverlay = isLoadingReader && chapterPayload != null;
  const showReaderLoadingState = readerLoadState === "idle" || readerLoadState === "loading";
  const chapterIndex =
    selectedBook && selectedChapter
      ? selectedBook.chapters.findIndex((chapter) => chapter.slug === selectedChapter.slug)
      : -1;
  const previousChapter = chapterIndex > 0 && selectedBook ? (selectedBook.chapters[chapterIndex - 1] ?? null) : null;
  const nextChapter =
    chapterIndex >= 0 && selectedBook && chapterIndex < selectedBook.chapters.length - 1
      ? (selectedBook.chapters[chapterIndex + 1] ?? null)
      : null;

  const hasLockedTranslations = selectedBook?.translations.some(
    (translation) => translation.accessLevel === "loggedin",
  );

  function openAuthDialog(input?: { mode?: AuthMode; message?: string | null; intent?: ProtectedIntent }) {
    setAuthMode(input?.mode ?? "signup");
    setAuthPromptMessage(input?.message ?? null);
    setPendingProtectedIntent(input?.intent ?? null);
    setAuthError(null);
    setIsAuthDialogOpen(true);
  }

  function closeAuthDialog() {
    setIsAuthDialogOpen(false);
    setAuthError(null);
    setAuthPromptMessage(null);
    setPendingProtectedIntent(null);
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmittingAuth(true);
    setAuthError(null);

    try {
      const payload =
        authMode === "signup"
          ? await api.signup({ email: authEmail, password: authPassword })
          : await api.login({ email: authEmail, password: authPassword });

      setAuthUser(payload.user);
      setAuthPassword("");
      setIsAuthDialogOpen(false);
      setAuthPromptMessage(null);
      setAuthError(null);

      const intent = pendingProtectedIntent;
      setPendingProtectedIntent(null);

      if (!intent) {
        return;
      }

      if (intent.kind === "book") {
        openBook(intent.bookSlug);
        return;
      }

      if (selectedBook?.slug === intent.bookSlug) {
        openTranslation(intent.translationSlug);
        return;
      }

      setPendingTranslationAfterAuth({
        bookSlug: intent.bookSlug,
        translationSlug: intent.translationSlug,
      });
      openBook(intent.bookSlug);
    } catch (submitError) {
      setAuthError(submitError instanceof Error ? submitError.message : "Authentication failed.");
    } finally {
      setIsSubmittingAuth(false);
    }
  }

  async function logout() {
    try {
      await api.logout();
      setAuthUser(null);
      returnToLibrary();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "Failed to log out.");
    }
  }

  function returnToLibrary() {
    setSelectedBookSlug(null);
    setSelectedBook(null);
    setSelectedTranslationSlug(null);
    setSelectedChapterSlug(null);
    setChapterPayload(null);
    setTranslationUnavailableMessage(null);
    setReaderLoadState("idle");
    setScreen("books");
  }

  function returnToTranslations() {
    setSelectedTranslationSlug(null);
    setSelectedChapterSlug(null);
    setChapterPayload(null);
    setTranslationUnavailableMessage(null);
    setReaderLoadState("idle");
    setScreen("translations");
  }

  function openBook(bookSlug: string) {
    setSelectedBookSlug(bookSlug);
    setSelectedTranslationSlug(null);
    setSelectedChapterSlug(null);
    setChapterPayload(null);
    setTranslationUnavailableMessage(null);
    setReaderLoadState("idle");
    setScreen("translations");
  }

  function openTranslation(translationSlug: string) {
    const firstChapterSlug = selectedBook?.chapters[0]?.slug ?? null;
    const storedChapterSlug =
      selectedBook == null ? null : getStoredLastReadChapter(selectedBook.slug, translationSlug);
    const preferredChapterSlug =
      storedChapterSlug != null && selectedBook?.chapters.some((chapter) => chapter.slug === storedChapterSlug)
        ? storedChapterSlug
        : firstChapterSlug;

    setSelectedTranslationSlug(translationSlug);
    setSelectedChapterSlug(preferredChapterSlug);
    setChapterPayload(null);
    setReaderLoadState(preferredChapterSlug ? "loading" : "idle");
    setScreen("reader");
  }

  function openChapter(chapterSlug: string) {
    setSelectedChapterSlug(chapterSlug);
    setReaderLoadState("loading");
    setScreen("reader");
  }

  function handleOpenBook(book: BookSummary) {
    if (!authUser && book.accessLevel === "loggedin") {
      openAuthDialog({
        mode: "signup",
        message: "Sign up for free to unlock this book.",
        intent: { kind: "book", bookSlug: book.slug },
      });
      return;
    }

    openBook(book.slug);
  }

  function handleOpenTranslation(translation: TranslationSummary) {
    if (!authUser && translation.accessLevel === "loggedin" && selectedBook) {
      openAuthDialog({
        mode: "signup",
        message: "Sign up for free to read this translation.",
        intent: {
          kind: "translation",
          bookSlug: selectedBook.slug,
          translationSlug: translation.slug,
        },
      });
      return;
    }

    openTranslation(translation.slug);
  }

  const breadcrumbs = useMemo(
    () =>
      [
        {
          label: "Library",
          isCurrent: screen === "books",
          onClick: returnToLibrary,
        },
        screen !== "books" && selectedBook
          ? {
              label: selectedBook.title,
              isCurrent: screen === "translations",
              onClick: returnToTranslations,
            }
          : null,
        screen === "reader" && selectedTranslation
          ? {
              label: selectedTranslation.name,
              isCurrent: selectedChapter == null,
              onClick: () => setScreen("reader"),
            }
          : null,
        screen === "reader" && selectedChapter
          ? {
              label: selectedChapter.title,
              isCurrent: screen === "reader",
              onClick: () => setScreen("reader"),
            }
          : null,
      ].filter(Boolean) as Array<{ label: string; isCurrent: boolean; onClick: () => void }>,
    [screen, selectedBook, selectedChapter, selectedTranslation],
  );

  return (
    <main className="min-h-screen bg-paper px-6 py-8 text-ink lg:px-10">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-8">
        <header className="flex items-center justify-between gap-4 rounded-full border border-border/70 bg-white/82 px-5 py-3 shadow-panel backdrop-blur">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-accent">Ancient Epics</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {isLoadingSession ? null : authUser ? (
              <>
                <span className="rounded-full border border-border/70 bg-paper/85 px-4 py-2 text-sm text-ink/72">
                  {authUser.email}
                </span>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="rounded-full border border-border/70 bg-paper/90 px-4 py-2 text-sm font-semibold transition hover:border-accent/50"
                >
                  Log Out
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => openAuthDialog({ mode: "login" })}
                  className="rounded-full border border-border/70 bg-paper/90 px-4 py-2 text-sm font-semibold transition hover:border-accent/50"
                >
                  Log In
                </button>
                <button
                  type="button"
                  onClick={() => openAuthDialog({ mode: "signup" })}
                  className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper transition hover:bg-accent"
                >
                  Sign Up
                </button>
              </>
            )}
          </div>
        </header>

        {error ? <StatusPanel title="Error" body={error} /> : null}

        {screen === "books" ? (
          <StagePanel
            title="Books"
            subtitle="Choose a published work. Free titles open immediately, and account-required titles will ask you to sign up."
            breadcrumbs={breadcrumbs}
          >
            {isLoadingBooks ? (
              <EmptyState body="Loading books..." />
            ) : books.length === 0 ? (
              <EmptyState body="No books are public yet. A book becomes visible once it has a published translation." />
            ) : (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {books.map((book) => (
                  <button
                    key={book.id}
                    type="button"
                    onClick={() => handleOpenBook(book)}
                    className="rounded-[28px] border border-border/70 bg-paper/72 p-6 text-left transition hover:border-accent/50 hover:bg-white"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                        {book.originalLanguage || "Original"}
                      </p>
                      <AccessBadge accessLevel={book.accessLevel} />
                    </div>
                    <h2 className="mt-3 font-display text-4xl text-ink">{book.title}</h2>
                    <p className="mt-3 text-sm text-ink/68">{book.author || "Unknown author"}</p>
                    <p className="mt-5 text-sm leading-7 text-ink/74">
                      {book.description || "Published without a description."}
                    </p>
                    {!authUser && book.accessLevel === "loggedin" ? (
                      <p className="mt-4 text-sm font-semibold text-accent">Sign up for free to unlock this book.</p>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </StagePanel>
        ) : null}

        {screen === "translations" ? (
          <StagePanel
            title={selectedBook?.title ?? "Translations"}
            subtitle="Choose a published translation for this book."
            backLabel="Back To Books"
            onBack={returnToLibrary}
            breadcrumbs={breadcrumbs}
          >
            {isLoadingBook ? (
              <EmptyState body="Loading translations..." />
            ) : selectedBook == null ? (
              <EmptyState body="Choose a book from the library first." />
            ) : selectedBook.translations.length === 0 ? (
              <EmptyState body="This book does not have any published translations yet." />
            ) : (
              <div className="space-y-6">
                <div className="max-w-3xl rounded-[28px] border border-border/70 bg-paper/68 p-6">
                  <p className="text-sm text-ink/68">{selectedBook.author || "Unknown author"}</p>
                  <p className="mt-4 text-base leading-8 text-ink/74">
                    {selectedBook.description || "Published without a description."}
                  </p>
                </div>

                {!authUser && hasLockedTranslations ? (
                  <div className="rounded-[24px] border border-border/70 bg-paper/68 px-5 py-4 text-sm leading-7 text-ink/72">
                    Free-to-read translations are available immediately. Create a free account to unlock the rest.
                  </div>
                ) : null}

                <div className="grid gap-5 lg:grid-cols-2">
                  {selectedBook.translations.map((translation) => (
                    <TranslationCard
                      key={translation.id}
                      translation={translation}
                      isGuest={!authUser}
                      onOpen={() => handleOpenTranslation(translation)}
                    />
                  ))}
                </div>
              </div>
            )}
          </StagePanel>
        ) : null}

        {screen === "reader" ? (
          <StagePanel
            title={selectedTranslation?.name ?? activeChapterTitle}
            subtitle={selectedBook ? `Reading ${selectedBook.title}` : ""}
            backLabel="Back To Translations"
            onBack={returnToTranslations}
            breadcrumbs={breadcrumbs}
          >
            {selectedBook == null || selectedTranslation == null || selectedChapter == null ? (
              <EmptyState body="Choose a book, translation, and chapter first." />
            ) : (
              <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
                <aside className="rounded-[28px] border border-border/70 bg-paper/62 p-4">
                  <p className="px-3 text-xs font-semibold uppercase tracking-[0.18em] text-accent">Chapters</p>
                  <div className="mt-3 space-y-2">
                    {selectedBook.chapters.map((chapter) => {
                      const isActive = chapter.slug === selectedChapter.slug;
                      return (
                        <button
                          key={chapter.id}
                          type="button"
                          onClick={() => openChapter(chapter.slug)}
                          aria-current={isActive ? "page" : undefined}
                          className={`w-full rounded-[20px] px-4 py-3 text-left transition ${
                            isActive
                              ? "border border-accent/25 bg-white text-ink shadow-sm"
                              : "border border-transparent bg-transparent hover:border-accent/18 hover:bg-white/80"
                          }`}
                        >
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
                            Chapter {chapter.position}
                          </p>
                          <p className="mt-1 text-sm font-semibold leading-6 text-ink">{chapter.title}</p>
                        </button>
                      );
                    })}
                  </div>
                </aside>

                <div className="space-y-6">
                  <div className="rounded-[24px] border border-border/70 bg-paper/68 px-5 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                      Chapter {selectedChapter.position}
                    </p>
                    <h3 className="mt-2 font-display text-3xl text-ink">{activeChapterTitle}</h3>
                  </div>

                  {showReaderLoadingState && chapterPayload == null ? (
                    <EmptyState body="Loading bilingual reader..." />
                  ) : readerLoadState === "error" || chapterPayload == null ? (
                    <EmptyState body="The bilingual reader for this chapter could not be loaded." />
                  ) : (
                    <>
                      {chapterPayload.translation == null ? (
                        <div className="rounded-[24px] border border-amber-300/70 bg-amber-50 px-5 py-4 text-sm leading-7 text-amber-950">
                          {translationUnavailableMessage ??
                            "This translation is not available for the selected chapter yet. Showing the original text only."}
                        </div>
                      ) : null}

                      <section className="relative overflow-hidden rounded-[32px] border border-border/70 bg-white/85 shadow-panel">
                        {showReaderLoadingOverlay ? (
                          <div className="absolute inset-0 z-10 flex items-center justify-center bg-paper/45 backdrop-blur-[1px]">
                            <div className="rounded-full border border-border/70 bg-white/90 px-4 py-2 text-sm font-semibold text-ink/72 shadow-sm">
                              Loading chapter...
                            </div>
                          </div>
                        ) : null}
                        <div
                          className={`grid gap-0 border-b border-border/60 bg-paper/65 px-6 py-4 ${
                            chapterPayload.translation ? "md:grid-cols-2" : ""
                          }`}
                        >
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Original</p>
                          </div>
                          {chapterPayload.translation ? (
                            <div className="md:border-l md:border-border/60 md:pl-6">
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                                {selectedTranslation.name}
                              </p>
                            </div>
                          ) : null}
                        </div>

                        <div className="space-y-1">
                          {chapterPayload.translation
                            ? translationRows.map((chunk) => (
                                <div key={chunk.id} className="grid gap-0 px-6 py-5 md:grid-cols-2">
                                  <PassageColumn text={chunk.originalText} />
                                  <PassageColumn text={chunk.translatedText} withBorder />
                                </div>
                              ))
                            : chapterPayload.original.fullText.split(/\n{2,}/).map((paragraph, index) => (
                                <div key={`original-${index}`} className="px-6 py-5">
                                  <PassageColumn text={paragraph} />
                                </div>
                              ))}
                        </div>
                      </section>
                    </>
                  )}

                  <div className="flex justify-end">
                    <ChapterNav
                      previousChapter={previousChapter}
                      nextChapter={nextChapter}
                      onOpenChapter={openChapter}
                    />
                  </div>
                </div>
              </div>
            )}
          </StagePanel>
        ) : null}
      </div>
      {isAuthDialogOpen ? (
        <AuthDialog
          authMode={authMode}
          email={authEmail}
          password={authPassword}
          error={authError}
          isBusy={isSubmittingAuth}
          promptMessage={authPromptMessage}
          onClose={closeAuthDialog}
          onModeChange={setAuthMode}
          onEmailChange={setAuthEmail}
          onPasswordChange={setAuthPassword}
          onSubmit={submitAuth}
        />
      ) : null}
    </main>
  );
}

function StagePanel({
  title,
  subtitle,
  children,
  backLabel,
  onBack,
  breadcrumbs,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  backLabel?: string;
  onBack?: () => void;
  breadcrumbs: Array<{ label: string; isCurrent: boolean; onClick: () => void }>;
}) {
  return (
    <section className="rounded-[32px] border border-border/70 bg-white/82 p-6 shadow-panel backdrop-blur lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 pb-5">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink/60">
            {breadcrumbs.map((crumb, index) => (
              <div key={`${crumb.label}-${index}`} className="flex items-center gap-2">
                {index > 0 ? <span className="text-ink/35">/</span> : null}
                {crumb.isCurrent ? (
                  <span className="font-semibold text-ink">{crumb.label}</span>
                ) : (
                  <button type="button" onClick={crumb.onClick} className="transition hover:text-ink">
                    {crumb.label}
                  </button>
                )}
              </div>
            ))}
          </div>
          <h2 className="font-display text-4xl text-ink lg:text-5xl">{title}</h2>
          <p className="max-w-3xl text-base leading-8 text-ink/72">{subtitle}</p>
        </div>
        {backLabel && onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded-full border border-border/70 bg-paper/90 px-4 py-2 text-sm font-semibold transition hover:border-accent/50"
          >
            {backLabel}
          </button>
        ) : null}
      </div>

      <div className="mt-6">{children}</div>
    </section>
  );
}

function TranslationCard({
  translation,
  isGuest,
  onOpen,
}: {
  translation: TranslationSummary;
  isGuest: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-[28px] border border-border/70 bg-paper/72 p-6 text-left transition hover:border-accent/50 hover:bg-white"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Translation</p>
        <AccessBadge accessLevel={translation.accessLevel} />
      </div>
      <h3 className="mt-3 font-display text-4xl text-ink">{translation.name}</h3>
      <p className="mt-4 text-base leading-8 text-ink/74">
        {translation.description || "Published without a description."}
      </p>
      {isGuest && translation.accessLevel === "loggedin" ? (
        <p className="mt-4 text-sm font-semibold text-accent">Sign up for free to read this translation.</p>
      ) : null}
    </button>
  );
}

function AccessBadge({ accessLevel }: { accessLevel: AccessLevel }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
        accessLevel === "public"
          ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border border-border/70 bg-white/75 text-ink/65"
      }`}
    >
      {accessLevel === "public" ? "Free To Read" : "Free Account"}
    </span>
  );
}

function PassageColumn({ text, withBorder = false }: { text: string; withBorder?: boolean }) {
  return (
    <div className={withBorder ? "md:border-l md:border-border/60 md:pl-6" : "md:pr-6"}>
      <p className="whitespace-pre-wrap text-base leading-8 text-ink/82">{text}</p>
    </div>
  );
}

function ChapterNav({
  previousChapter,
  nextChapter,
  onOpenChapter,
}: {
  previousChapter: BookDetail["chapters"][number] | null;
  nextChapter: BookDetail["chapters"][number] | null;
  onOpenChapter: (chapterSlug: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => previousChapter && onOpenChapter(previousChapter.slug)}
        disabled={previousChapter == null}
        className="rounded-full border border-border/70 bg-white/70 px-4 py-2 text-sm font-semibold transition hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-45"
      >
        Prev
      </button>
      <button
        type="button"
        onClick={() => nextChapter && onOpenChapter(nextChapter.slug)}
        disabled={nextChapter == null}
        className="rounded-full border border-border/70 bg-white/70 px-4 py-2 text-sm font-semibold transition hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-45"
      >
        Next
      </button>
    </div>
  );
}

function StatusPanel({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-[24px] border border-red-200 bg-red-50/90 p-4 text-red-900 shadow-panel">
      <p className="text-xs font-semibold uppercase tracking-[0.16em]">{title}</p>
      <p className="mt-2 text-sm">{body}</p>
    </section>
  );
}

function EmptyState({ body }: { body: string }) {
  return <p className="text-base leading-8 text-ink/68">{body}</p>;
}

function AuthDialog({
  authMode,
  email,
  password,
  error,
  isBusy,
  promptMessage,
  onClose,
  onModeChange,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: {
  authMode: AuthMode;
  email: string;
  password: string;
  error: string | null;
  isBusy: boolean;
  promptMessage: string | null;
  onClose: () => void;
  onModeChange: (mode: AuthMode) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/28 px-6 py-8 backdrop-blur-sm">
      <div className="w-full max-w-[560px] rounded-[32px] border border-border/70 bg-white/95 p-6 shadow-panel lg:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Ancient Epics</p>
            <h2 className="mt-3 font-display text-4xl text-ink">
              {authMode === "signup" ? "Create Your Free Account" : "Log In"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border/70 bg-paper/90 px-4 py-2 text-sm font-semibold transition hover:border-accent/50"
          >
            Close
          </button>
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => onModeChange("signup")}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              authMode === "signup" ? "bg-ink text-paper" : "border border-border/70 bg-paper/80 text-ink/72"
            }`}
          >
            Sign Up
          </button>
          <button
            type="button"
            onClick={() => onModeChange("login")}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              authMode === "login" ? "bg-ink text-paper" : "border border-border/70 bg-paper/80 text-ink/72"
            }`}
          >
            Log In
          </button>
        </div>

        {promptMessage ? (
          <div className="mt-5 rounded-[24px] border border-border/70 bg-paper/68 px-5 py-4 text-sm leading-7 text-ink/74">
            {promptMessage}
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              className="rounded-2xl border border-border/70 bg-paper/70 px-4 py-3 text-base text-ink outline-none transition focus:border-accent"
              autoComplete="email"
              placeholder="you@example.com"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              className="rounded-2xl border border-border/70 bg-paper/70 px-4 py-3 text-base text-ink outline-none transition focus:border-accent"
              autoComplete={authMode === "signup" ? "new-password" : "current-password"}
              placeholder="At least 8 characters"
            />
          </label>

          {error ? <p className="text-sm text-red-700">{error}</p> : null}

          <button
            type="submit"
            disabled={isBusy}
            className="w-full rounded-full bg-ink px-4 py-3 text-sm font-semibold text-paper transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? "Working..." : authMode === "signup" ? "Sign Up For Free" : "Log In"}
          </button>
        </form>
      </div>
    </div>
  );
}
