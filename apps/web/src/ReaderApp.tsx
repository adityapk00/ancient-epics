import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { BookDetail, BookSummary, ChapterPayload, TranslationPayload } from "@ancient-epics/shared";

import { api } from "./lib/api";

type ReaderAppProps = {
  onOpenAdmin: () => void;
};

export default function ReaderApp({ onOpenAdmin }: ReaderAppProps) {
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [selectedBookSlug, setSelectedBookSlug] = useState<string | null>(null);
  const [selectedBook, setSelectedBook] = useState<BookDetail | null>(null);
  const [selectedChapterSlug, setSelectedChapterSlug] = useState<string | null>(null);
  const [selectedTranslationSlug, setSelectedTranslationSlug] = useState<string | null>(null);
  const [chapterPayload, setChapterPayload] = useState<ChapterPayload | null>(null);
  const [translationPayload, setTranslationPayload] = useState<TranslationPayload | null>(null);
  const [isLoadingBooks, setIsLoadingBooks] = useState(true);
  const [isLoadingBook, setIsLoadingBook] = useState(false);
  const [isLoadingChapter, setIsLoadingChapter] = useState(false);
  const [isLoadingTranslation, setIsLoadingTranslation] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        setSelectedBookSlug((current) => current ?? payload.books[0]?.slug ?? null);
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
      setSelectedChapterSlug(null);
      setSelectedTranslationSlug(null);
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
        setSelectedChapterSlug((current) => {
          if (current && payload.chapters.some((chapter) => chapter.slug === current)) {
            return current;
          }
          return payload.chapters[0]?.slug ?? null;
        });
        setSelectedTranslationSlug((current) => {
          if (current && payload.translations.some((translation) => translation.slug === current)) {
            return current;
          }
          return payload.translations[0]?.slug ?? null;
        });
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
    if (!selectedBook || !selectedChapterSlug) {
      setChapterPayload(null);
      setTranslationPayload(null);
      return;
    }

    const bookSlug = selectedBook.slug;
    const chapterSlug = selectedChapterSlug;
    let isCancelled = false;

    async function loadChapter() {
      setIsLoadingChapter(true);
      setError(null);
      setChapterPayload(null);

      try {
        const payload = await api.getChapter(bookSlug, chapterSlug);
        if (isCancelled) {
          return;
        }
        setChapterPayload(payload);
      } catch (loadError) {
        if (!isCancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load chapter.");
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingChapter(false);
        }
      }
    }

    void loadChapter();
    return () => {
      isCancelled = true;
    };
  }, [selectedBook, selectedChapterSlug]);

  useEffect(() => {
    if (!selectedBook || !selectedChapterSlug || !selectedTranslationSlug) {
      setTranslationPayload(null);
      return;
    }

    const bookSlug = selectedBook.slug;
    const chapterSlug = selectedChapterSlug;
    const translationSlug = selectedTranslationSlug;
    let isCancelled = false;

    async function loadTranslation() {
      setIsLoadingTranslation(true);
      setError(null);
      setTranslationPayload(null);

      try {
        const payload = await api.getTranslation(bookSlug, chapterSlug, translationSlug);
        if (isCancelled) {
          return;
        }
        setTranslationPayload(payload);
      } catch (loadError) {
        if (!isCancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load translation.");
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingTranslation(false);
        }
      }
    }

    void loadTranslation();
    return () => {
      isCancelled = true;
    };
  }, [selectedBook, selectedChapterSlug, selectedTranslationSlug]);

  const originalRows = useMemo(() => {
    if (translationPayload) {
      return translationPayload.content.chunks.map((chunk) => ({
        id: chunk.id,
        type: chunk.type,
        originalText: chunk.originalText,
      }));
    }

    if (chapterPayload) {
      return [
        {
          id: chapterPayload.chapter.id,
          type: "prose" as const,
          originalText: chapterPayload.original.fullText,
        },
      ];
    }

    return [];
  }, [chapterPayload, translationPayload]);
  const translationRows = translationPayload?.content.chunks ?? [];

  const chapterTitle =
    chapterPayload?.chapter.title ??
    selectedBook?.chapters.find((chapter) => chapter.slug === selectedChapterSlug)?.title;
  const currentTranslation =
    selectedBook?.translations.find((translation) => translation.slug === selectedTranslationSlug) ?? null;

  return (
    <main className="min-h-screen bg-paper px-6 py-8 text-ink lg:px-10">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-8">
        <section className="grid gap-6 rounded-[32px] border border-border/70 bg-white/80 p-6 shadow-panel backdrop-blur lg:grid-cols-[1.2fr_320px] lg:p-8">
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent">Ancient Epics</p>
            <div className="space-y-3">
              <h1 className="max-w-4xl font-display text-5xl leading-tight text-ink lg:text-6xl">
                Read original texts with live translation variants side by side.
              </h1>
              <p className="max-w-3xl text-base leading-8 text-ink/72">
                Browse the published library, choose a chapter, then switch between translation approaches without
                losing the original text.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm text-ink/68">
              <ReaderStat label="Books" value={String(books.length)} />
              <ReaderStat label="Chapters" value={String(selectedBook?.chapters.length ?? 0)} />
              <ReaderStat label="View" value={currentTranslation ? "Bilingual" : "Original"} />
            </div>
          </div>

          <div className="flex items-start justify-end">
            <button
              type="button"
              onClick={onOpenAdmin}
              className="rounded-full border border-border/70 bg-paper/90 px-4 py-2 text-sm font-semibold transition hover:border-accent/50"
            >
              Admin
            </button>
          </div>
        </section>

        {error ? <StatusPanel title="Error" body={error} /> : null}

        <section className="grid gap-6 xl:grid-cols-[300px_340px_1fr]">
          <aside className="space-y-6">
            <ReaderPanel title="Library">
              {isLoadingBooks ? (
                <p className="text-sm text-ink/65">Loading books...</p>
              ) : books.length === 0 ? (
                <p className="text-sm leading-7 text-ink/65">No published books are available yet.</p>
              ) : (
                <div className="space-y-3">
                  {books.map((book) => (
                    <button
                      key={book.id}
                      type="button"
                      onClick={() => setSelectedBookSlug(book.slug)}
                      className={`w-full rounded-[24px] border p-4 text-left transition ${
                        selectedBookSlug === book.slug
                          ? "border-accent/60 bg-white"
                          : "border-border/70 bg-paper/70 hover:border-accent/40 hover:bg-white"
                      }`}
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                        {book.originalLanguage || "Original"}
                      </p>
                      <h2 className="mt-2 font-display text-3xl text-ink">{book.title}</h2>
                      <p className="mt-2 text-sm text-ink/68">{book.author || "Unknown author"}</p>
                    </button>
                  ))}
                </div>
              )}
            </ReaderPanel>
          </aside>

          <aside className="space-y-6">
            <ReaderPanel title="Reading Plan">
              {selectedBook ? (
                <div className="space-y-5">
                  <div>
                    <h2 className="font-display text-4xl text-ink">{selectedBook.title}</h2>
                    <p className="mt-2 text-sm text-ink/68">{selectedBook.author || "Unknown author"}</p>
                    <p className="mt-4 text-sm leading-7 text-ink/72">
                      {selectedBook.description || "Published without a description."}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Translations</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <TranslationPill
                        label="Original Only"
                        isActive={selectedTranslationSlug == null}
                        onClick={() => setSelectedTranslationSlug(null)}
                      />
                      {selectedBook.translations.map((translation) => (
                        <TranslationPill
                          key={translation.id}
                          label={translation.name}
                          isActive={translation.slug === selectedTranslationSlug}
                          onClick={() => setSelectedTranslationSlug(translation.slug)}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Chapters</p>
                    <div className="mt-3 space-y-2">
                      {selectedBook.chapters.map((chapter) => (
                        <button
                          key={chapter.id}
                          type="button"
                          onClick={() => setSelectedChapterSlug(chapter.slug)}
                          className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                            chapter.slug === selectedChapterSlug
                              ? "border-accent/60 bg-white"
                              : "border-border/70 bg-paper/72 hover:border-accent/40 hover:bg-white"
                          }`}
                        >
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
                            Chapter {chapter.position}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-ink">{chapter.title}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm leading-7 text-ink/65">Choose a published book to start reading.</p>
              )}
            </ReaderPanel>
          </aside>

          <section className="space-y-6">
            <ReaderPanel title="Reader">
              {selectedBook == null ? (
                <p className="text-sm leading-7 text-ink/65">Choose a book from the library to open the reader.</p>
              ) : isLoadingBook || isLoadingChapter ? (
                <p className="text-sm text-ink/65">Loading chapter...</p>
              ) : chapterPayload == null ? (
                <p className="text-sm leading-7 text-ink/65">No published chapter is available for this book.</p>
              ) : (
                <div className="space-y-6">
                  <header className="space-y-3 border-b border-border/60 pb-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                        {selectedBook.title}
                      </p>
                      <span className="text-sm text-ink/45">/</span>
                      <p className="text-sm text-ink/62">{chapterTitle}</p>
                    </div>
                    <h2 className="font-display text-4xl text-ink">{chapterTitle}</h2>
                    <p className="text-sm text-ink/68">
                      {currentTranslation ? currentTranslation.name : "Original text only"}
                      {isLoadingTranslation ? " · loading translation..." : null}
                    </p>
                    {currentTranslation?.description ? (
                      <p className="max-w-3xl text-sm leading-7 text-ink/72">{currentTranslation.description}</p>
                    ) : null}
                  </header>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <article className="rounded-[28px] border border-border/70 bg-paper/72 p-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Original</p>
                      <div className="mt-4 space-y-4">
                        {originalRows.map((row) => (
                          <PassageBlock key={row.id} text={row.originalText} type={row.type} />
                        ))}
                      </div>
                    </article>

                    <article className="rounded-[28px] border border-border/70 bg-white/75 p-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                        {currentTranslation ? currentTranslation.name : "Notes"}
                      </p>
                      <div className="mt-4 space-y-4">
                        {currentTranslation ? (
                          translationPayload ? (
                            translationRows.map((row) => (
                              <PassageBlock key={row.id} text={row.translatedText} type={row.type} isTranslation />
                            ))
                          ) : (
                            <p className="text-sm leading-8 text-ink/68">Loading translation...</p>
                          )
                        ) : (
                          <p className="text-sm leading-8 text-ink/68">
                            Choose a published translation to compare it against the original text chapter by chapter.
                          </p>
                        )}
                      </div>
                    </article>
                  </div>
                </div>
              )}
            </ReaderPanel>
          </section>
        </section>
      </div>
    </main>
  );
}

function ReaderPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[28px] border border-border/70 bg-white/82 p-5 shadow-panel backdrop-blur">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{title}</p>
      <div className="mt-4">{children}</div>
    </section>
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

function TranslationPill({ label, isActive, onClick }: { label: string; isActive: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
        isActive
          ? "border-accent/60 bg-ink text-paper"
          : "border-border/70 bg-paper/70 text-ink hover:border-accent/40 hover:bg-white"
      }`}
    >
      {label}
    </button>
  );
}

function PassageBlock({
  text,
  type,
  isTranslation = false,
}: {
  text: string;
  type: "prose" | "verse";
  isTranslation?: boolean;
}) {
  return (
    <div className={`rounded-2xl border border-border/60 p-4 ${isTranslation ? "bg-paper/45" : "bg-white/65"}`}>
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{type}</p>
      <p
        className={
          type === "verse"
            ? "whitespace-pre-wrap text-base leading-8"
            : "whitespace-pre-wrap text-base leading-8 text-ink/82"
        }
      >
        {text}
      </p>
    </div>
  );
}

function ReaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-border/70 bg-paper/72 px-4 py-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{label}</span>
      <span className="ml-2 text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}
