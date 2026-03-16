import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { BookDetail, BookSummary, ReaderChapterPayload, TranslationSummary } from "@ancient-epics/shared";

import { api } from "./lib/api";

type ReaderScreen = "books" | "translations" | "reader";
type ReaderLoadState = "idle" | "loading" | "ready" | "error";

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

  function openBook(bookSlug: string) {
    setSelectedBookSlug(bookSlug);
    setSelectedTranslationSlug(null);
    setSelectedChapterSlug(null);
    setChapterPayload(null);
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

  const breadcrumbs = useMemo(
    () =>
      [
        {
          label: "Library",
          isCurrent: screen === "books",
          onClick: () => setScreen("books"),
        },
        screen !== "books" && selectedBook
          ? {
              label: selectedBook.title,
              isCurrent: screen === "translations",
              onClick: () => setScreen("translations"),
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
        </header>

        {error ? <StatusPanel title="Error" body={error} /> : null}

        {screen === "books" ? (
          <StagePanel
            title="Books"
            subtitle="Choose a published work to see the translations available for it."
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
                    onClick={() => openBook(book.slug)}
                    className="rounded-[28px] border border-border/70 bg-paper/72 p-6 text-left transition hover:border-accent/50 hover:bg-white"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                      {book.originalLanguage || "Original"}
                    </p>
                    <h2 className="mt-3 font-display text-4xl text-ink">{book.title}</h2>
                    <p className="mt-3 text-sm text-ink/68">{book.author || "Unknown author"}</p>
                    <p className="mt-5 text-sm leading-7 text-ink/74">
                      {book.description || "Published without a description."}
                    </p>
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
            onBack={() => setScreen("books")}
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

                <div className="grid gap-5 lg:grid-cols-2">
                  {selectedBook.translations.map((translation) => (
                    <TranslationCard
                      key={translation.id}
                      translation={translation}
                      onOpen={() => openTranslation(translation.slug)}
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
            onBack={() => setScreen("translations")}
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

function TranslationCard({ translation, onOpen }: { translation: TranslationSummary; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-[28px] border border-border/70 bg-paper/72 p-6 text-left transition hover:border-accent/50 hover:bg-white"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Translation</p>
      <h3 className="mt-3 font-display text-4xl text-ink">{translation.name}</h3>
      <p className="mt-4 text-base leading-8 text-ink/74">
        {translation.description || "Published without a description."}
      </p>
    </button>
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
