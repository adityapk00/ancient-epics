import type { AdminBookSummary } from "@ancient-epics/shared";

import type { BreadcrumbItem } from "../components/BreadcrumbTrail";
import { EmptyState } from "../components/EmptyState";
import { StagePanel } from "../components/StagePanel";
import { ActionButton, Metric, Panel } from "./ui";
import { formatTimestamp, getBookPublicationStatus } from "./utils";

export function BooksScreen({
  books,
  breadcrumbs,
  onCreateBook,
  onOpenBook,
  onEditBook,
  onDeleteBook,
}: {
  books: AdminBookSummary[];
  breadcrumbs: BreadcrumbItem[];
  onCreateBook: () => void;
  onOpenBook: (bookSlug: string) => void;
  onEditBook: (book: AdminBookSummary) => void;
  onDeleteBook: (book: AdminBookSummary) => void;
}) {
  return (
    <StagePanel
      title="Books"
      subtitle="Browse books, inspect publication status, and jump into translation workspaces without manual screen state."
      breadcrumbs={breadcrumbs}
    >
      <section className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Panel title="Catalog">
          {books.length === 0 ? (
            <EmptyState body="No books created yet." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {books.map((book) => (
                <div key={book.id} className="rounded-[24px] border border-border/70 bg-paper/80 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                      {getBookPublicationStatus(book.publishedTranslationCount)}
                    </p>
                    <span className="text-xs text-ink/55">{formatTimestamp(book.latestActivityAt)}</span>
                  </div>
                  <h2 className="mt-3 font-display text-3xl text-ink">{book.title}</h2>
                  <p className="mt-2 text-sm text-ink/65">{book.author || "Unknown author"}</p>
                  <p className="mt-4 text-sm leading-7 text-ink/75">{book.description || "No description yet."}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-ink/70">
                    <Metric label="Chapters" value={String(book.chapterCount)} />
                    <Metric label="Translations" value={String(book.translationCount)} />
                    <Metric label="Published" value={String(book.publishedTranslationCount)} />
                    <Metric label="Language" value={book.originalLanguage || "Unknown"} />
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <ActionButton label="Open" onClick={() => onOpenBook(book.slug)} tone="accent" />
                    <ActionButton label="Edit" onClick={() => onEditBook(book)} />
                    <button
                      type="button"
                      onClick={() => onDeleteBook(book)}
                      className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Create New">
          <p className="text-base leading-7 text-ink/70">
            Paste a source text, split it into chapters, and keep the stored model as plain books, chapters, and
            translations.
          </p>
          <div className="mt-6">
            <ActionButton label="Create New Book" onClick={onCreateBook} tone="accent" />
          </div>
        </Panel>
      </section>
    </StagePanel>
  );
}
