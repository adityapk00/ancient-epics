import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { BookDetail, BookSummary, ReaderChapterPayload, TranslationSummary } from "@ancient-epics/shared";

import { api } from "./lib/api";

type ReaderAppProps = {
  onOpenAdmin: () => void;
};

type ReaderScreen = "books" | "translations" | "chapters" | "reader";

export default function ReaderApp({ onOpenAdmin }: ReaderAppProps) {
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
      return;
    }

    const bookSlug = selectedBook.slug;
    const chapterSlug = selectedChapterSlug;
    const translationSlug = selectedTranslationSlug;
    let isCancelled = false;

    async function loadReaderContent() {
      setIsLoadingReader(true);
      setError(null);
      setChapterPayload(null);
      setTranslationUnavailableMessage(null);

      try {
        const chapter = await api.getChapter(bookSlug, chapterSlug, translationSlug);
        if (isCancelled) {
          return;
        }
        setChapterPayload(chapter);
        if (!chapter.translation) {
          setTranslationUnavailableMessage("This translation is not available for the selected chapter yet.");
        }
      } catch (loadError) {
        if (!isCancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load reader content.");
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

  const selectedTranslation =
    selectedBook?.translations.find((translation) => translation.slug === selectedTranslationSlug) ?? null;
  const selectedChapter = selectedBook?.chapters.find((chapter) => chapter.slug === selectedChapterSlug) ?? null;
  const translationRows = chapterPayload?.translation?.content.chunks ?? [];
  const activeChapterTitle = chapterPayload?.chapter.title ?? selectedChapter?.title ?? "Chapter";
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
    setSelectedTranslationSlug(translationSlug);
    setSelectedChapterSlug(null);
    setChapterPayload(null);
    setScreen("chapters");
  }

  function openChapter(chapterSlug: string) {
    setSelectedChapterSlug(chapterSlug);
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
        (screen === "chapters" || screen === "reader") && selectedTranslation
          ? {
              label: selectedTranslation.name,
              isCurrent: screen === "chapters",
              onClick: () => setScreen("chapters"),
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
          <button
            type="button"
            onClick={onOpenAdmin}
            className="rounded-full border border-border/70 bg-paper/90 px-4 py-2 text-sm font-semibold transition hover:border-accent/50"
          >
            Admin
          </button>
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

        {screen === "chapters" ? (
          <StagePanel
            title={selectedTranslation?.name ?? "Chapters"}
            subtitle="Choose a chapter to open the aligned bilingual reader."
            backLabel="Back To Translations"
            onBack={() => setScreen("translations")}
            breadcrumbs={breadcrumbs}
          >
            {isLoadingBook ? (
              <EmptyState body="Loading chapters..." />
            ) : selectedBook == null || selectedTranslation == null ? (
              <EmptyState body="Choose a book and translation first." />
            ) : selectedBook.chapters.length === 0 ? (
              <EmptyState body="No published chapters are available for this book yet." />
            ) : (
              <div className="space-y-6">
                <div className="max-w-3xl rounded-[28px] border border-border/70 bg-paper/68 p-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{selectedBook.title}</p>
                  <h2 className="mt-3 font-display text-4xl text-ink">{selectedTranslation.name}</h2>
                  <p className="mt-4 text-base leading-8 text-ink/74">
                    {selectedTranslation.description || "Published without a description."}
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {selectedBook.chapters.map((chapter) => (
                    <button
                      key={chapter.id}
                      type="button"
                      onClick={() => openChapter(chapter.slug)}
                      className="rounded-[24px] border border-border/70 bg-paper/72 p-5 text-left transition hover:border-accent/50 hover:bg-white"
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                        Chapter {chapter.position}
                      </p>
                      <h3 className="mt-2 text-lg font-semibold text-ink">{chapter.title}</h3>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </StagePanel>
        ) : null}

        {screen === "reader" ? (
          <StagePanel
            title={activeChapterTitle}
            subtitle=""
            backLabel="Back To Chapters"
            onBack={() => setScreen("chapters")}
            breadcrumbs={breadcrumbs}
          >
            {selectedBook == null || selectedTranslation == null || selectedChapter == null ? (
              <EmptyState body="Choose a book, translation, and chapter first." />
            ) : isLoadingReader ? (
              <EmptyState body="Loading bilingual reader..." />
            ) : chapterPayload == null ? (
              <EmptyState body="The bilingual reader for this chapter could not be loaded." />
            ) : (
              <div className="space-y-6">
                {chapterPayload.translation == null ? (
                  <div className="rounded-[24px] border border-amber-300/70 bg-amber-50 px-5 py-4 text-sm leading-7 text-amber-950">
                    {translationUnavailableMessage ??
                      "This translation is not available for the selected chapter yet. Showing the original text only."}
                  </div>
                ) : null}

                <section className="overflow-hidden rounded-[32px] border border-border/70 bg-white/85 shadow-panel">
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

                <div className="flex justify-end">
                  <ChapterNav previousChapter={previousChapter} nextChapter={nextChapter} onOpenChapter={openChapter} />
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
