import type { AuthUser, BookDetail, TranslationSummary } from "@ancient-epics/shared";

import { AccessBadge } from "../components/AccessBadge";
import type { BreadcrumbItem } from "../components/BreadcrumbTrail";
import { EmptyState } from "../components/EmptyState";
import { StagePanel } from "../components/StagePanel";
import { TranslationCard } from "../components/TranslationCard";

export function TranslationsScreen({
  selectedBook,
  breadcrumbs,
  isLoadingBook,
  authUser,
  hasLockedTranslations,
  onBack,
  onOpenTranslation,
}: {
  selectedBook: BookDetail | null;
  breadcrumbs: BreadcrumbItem[];
  isLoadingBook: boolean;
  authUser: AuthUser | null;
  hasLockedTranslations: boolean;
  onBack: () => void;
  onOpenTranslation: (translation: TranslationSummary) => void;
}) {
  return (
    <StagePanel
      title={selectedBook?.title ?? "Translations"}
      subtitle="Choose a published translation for this book."
      backLabel="Back To Books"
      onBack={onBack}
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
                title={translation.name}
                description={translation.description || "Published without a description."}
                eyebrow="Translation"
                badges={<AccessBadge accessLevel={translation.accessLevel} />}
                onOpen={() => onOpenTranslation(translation)}
                hint={
                  !authUser && translation.accessLevel === "loggedin"
                    ? "Sign up for free to read this translation."
                    : null
                }
              />
            ))}
          </div>
        </div>
      )}
    </StagePanel>
  );
}
