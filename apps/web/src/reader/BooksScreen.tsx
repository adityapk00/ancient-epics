import type { AuthUser, BookSummary } from "@ancient-epics/shared";

import { AccessBadge } from "../components/AccessBadge";
import { EmptyState } from "../components/EmptyState";
import { StagePanel } from "../components/StagePanel";
import type { BreadcrumbItem } from "../components/BreadcrumbTrail";

export function BooksScreen({
  books,
  breadcrumbs,
  isLoadingBooks,
  authUser,
  onOpenBook,
}: {
  books: BookSummary[];
  breadcrumbs: BreadcrumbItem[];
  isLoadingBooks: boolean;
  authUser: AuthUser | null;
  onOpenBook: (book: BookSummary) => void;
}) {
  return (
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
              onClick={() => onOpenBook(book)}
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
  );
}
