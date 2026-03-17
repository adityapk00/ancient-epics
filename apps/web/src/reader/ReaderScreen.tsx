import type { BookDetail, ReaderChapterPayload } from "@ancient-epics/shared";

import type { BreadcrumbItem } from "../components/BreadcrumbTrail";
import { EmptyState } from "../components/EmptyState";
import { StagePanel } from "../components/StagePanel";

type ReaderLoadState = "idle" | "loading" | "ready" | "error";

export function ReaderScreen({
  selectedBook,
  selectedTranslationName,
  selectedChapter,
  activeChapterTitle,
  chapterPayload,
  breadcrumbs,
  previousChapter,
  nextChapter,
  isLoadingReader,
  readerLoadState,
  translationUnavailableMessage,
  onBack,
  onOpenChapter,
}: {
  selectedBook: BookDetail | null;
  selectedTranslationName: string | null;
  selectedChapter: BookDetail["chapters"][number] | null;
  activeChapterTitle: string;
  chapterPayload: ReaderChapterPayload | null;
  breadcrumbs: BreadcrumbItem[];
  previousChapter: BookDetail["chapters"][number] | null;
  nextChapter: BookDetail["chapters"][number] | null;
  isLoadingReader: boolean;
  readerLoadState: ReaderLoadState;
  translationUnavailableMessage: string | null;
  onBack: () => void;
  onOpenChapter: (chapterSlug: string) => void;
}) {
  const translationRows = chapterPayload?.translation?.content.chunks ?? [];
  const showReaderLoadingOverlay = isLoadingReader && chapterPayload != null;
  const showReaderLoadingState = readerLoadState === "idle" || readerLoadState === "loading";

  return (
    <StagePanel
      title={selectedTranslationName ?? activeChapterTitle}
      subtitle={selectedBook ? `Reading ${selectedBook.title}` : ""}
      backLabel="Back To Translations"
      onBack={onBack}
      breadcrumbs={breadcrumbs}
    >
      {selectedBook == null || selectedChapter == null ? (
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
                    onClick={() => onOpenChapter(chapter.slug)}
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
                          {selectedTranslationName}
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
              <ChapterNav previousChapter={previousChapter} nextChapter={nextChapter} onOpenChapter={onOpenChapter} />
            </div>
          </div>
        </div>
      )}
    </StagePanel>
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
