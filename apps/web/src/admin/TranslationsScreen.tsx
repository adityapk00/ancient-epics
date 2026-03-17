import type { ChangeEvent, RefObject } from "react";
import type { UseFormReturn } from "react-hook-form";

import type { AdminBookSourcePayload, AdminTranslationSummary } from "@ancient-epics/shared";

import { AccessBadge } from "../components/AccessBadge";
import type { BreadcrumbItem } from "../components/BreadcrumbTrail";
import { EmptyState } from "../components/EmptyState";
import { StagePanel } from "../components/StagePanel";
import { TranslationCard } from "../components/TranslationCard";
import { TranslationFormFields } from "./TranslationFormFields";
import type { TranslationFormValues } from "./forms";
import { ActionButton, Metric, Panel, StatusPill } from "./ui";
import { formatProviderLabel, formatThinkingSummary, formatTimestamp } from "./utils";

export function TranslationsScreen({
  breadcrumbs,
  selectedBook,
  translations,
  selectedBookStatus,
  importTranslationInputRef,
  translationForm,
  isBusy,
  onBack,
  onPromptImport,
  onImportTranslation,
  onCreateTranslation,
  onOpenTranslation,
  onDeleteTranslation,
  onUnpublishTranslation,
}: {
  breadcrumbs: BreadcrumbItem[];
  selectedBook: AdminBookSourcePayload | null;
  translations: AdminTranslationSummary[];
  selectedBookStatus: string;
  importTranslationInputRef: RefObject<HTMLInputElement | null>;
  translationForm: UseFormReturn<TranslationFormValues>;
  isBusy: boolean;
  onBack: () => void;
  onPromptImport: () => void;
  onImportTranslation: (event: ChangeEvent<HTMLInputElement>) => void;
  onCreateTranslation: () => void;
  onOpenTranslation: (translationId: string) => void;
  onDeleteTranslation: (translation: AdminTranslationSummary) => void;
  onUnpublishTranslation: (translation: AdminTranslationSummary) => void;
}) {
  const title = translationForm.watch("title");
  const model = translationForm.watch("model");
  const prompt = translationForm.watch("prompt");

  return (
    <StagePanel
      title="Translations"
      subtitle="Review the current book, import archived drafts, or create a new translation with form-managed defaults."
      breadcrumbs={breadcrumbs}
      backLabel="Back To Books"
      onBack={onBack}
    >
      <section className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <Panel title="Current Book">
          {selectedBook ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{selectedBookStatus}</p>
              <h2 className="font-display text-4xl text-ink">{selectedBook.book.title}</h2>
              <p className="text-sm text-ink/65">{selectedBook.book.author || "Unknown author"}</p>
              <p className="text-sm leading-7 text-ink/75">{selectedBook.book.description || "No description yet."}</p>
              <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border/70 bg-paper/75 p-4 text-sm text-ink/70">
                <Metric label="Chapters" value={String(selectedBook.chapters.length)} />
                <Metric label="Translations" value={String(translations.length)} />
                <Metric
                  label="Published"
                  value={String(translations.filter((translation) => translation.status === "published").length)}
                />
                <Metric label="Language" value={selectedBook.book.originalLanguage || "Unknown"} />
              </div>
              <ActionButton label="Back To Books" onClick={onBack} />
            </div>
          ) : (
            <EmptyState body="Choose a book from the library first." />
          )}
        </Panel>

        <div className="grid gap-6">
          <Panel title="Translations">
            <input
              ref={importTranslationInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => onImportTranslation(event)}
            />
            <div className="mb-4 flex flex-wrap gap-3">
              <ActionButton
                label={isBusy ? "Importing..." : "Import Translation JSON"}
                onClick={onPromptImport}
                disabled={isBusy}
              />
            </div>
            {translations.length === 0 ? (
              <EmptyState body="No translations yet for this book." />
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {translations.map((translation) => (
                  <TranslationCard
                    key={translation.id}
                    title={translation.name}
                    description={translation.description || "No description yet."}
                    eyebrow="Translation"
                    badges={
                      <>
                        <StatusPill status={translation.status} />
                        <AccessBadge accessLevel={translation.accessLevel} />
                      </>
                    }
                    metadata={
                      <>
                        <span className="rounded-full border border-border/70 bg-white/75 px-3 py-1">
                          {formatProviderLabel(translation.provider)} · {translation.model}
                        </span>
                        <span className="rounded-full border border-border/70 bg-white/75 px-3 py-1">
                          {formatThinkingSummary(translation)}
                        </span>
                        <span className="rounded-full border border-border/70 bg-white/75 px-3 py-1">
                          {formatTimestamp(translation.latestActivityAt)}
                        </span>
                      </>
                    }
                    metrics={
                      <div className="grid grid-cols-2 gap-3 text-sm text-ink/70">
                        <Metric label="Saved" value={`${translation.savedChapterCount}/${translation.chapterCount}`} />
                        <Metric label="Draft" value={String(translation.draftChapterCount)} />
                        <Metric label="Errors" value={String(translation.errorChapterCount)} />
                        <Metric label="Published" value={translation.status === "published" ? "Yes" : "No"} />
                      </div>
                    }
                    actions={
                      <>
                        <ActionButton label="Open" onClick={() => onOpenTranslation(translation.id)} tone="accent" />
                        {translation.status === "published" ? (
                          <ActionButton label="Unpublish" onClick={() => onUnpublishTranslation(translation)} />
                        ) : null}
                        <button
                          type="button"
                          onClick={() => onDeleteTranslation(translation)}
                          className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
                        >
                          Delete
                        </button>
                      </>
                    }
                  />
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Create Translation">
            <TranslationFormFields form={translationForm} showSlug={false} promptRows={10} />
            <div className="mt-6 flex flex-wrap gap-3">
              <ActionButton
                label={isBusy ? "Creating..." : "Create Translation"}
                onClick={onCreateTranslation}
                tone="accent"
                disabled={isBusy || !title.trim() || !model.trim() || !prompt.trim()}
              />
            </div>
          </Panel>
        </div>
      </section>
    </StagePanel>
  );
}
