import type { UseFormReturn } from "react-hook-form";

import type {
  AdminTranslationDetail,
  AdminTranslationValidationChapter,
  AdminTranslationValidationPayload,
  TranslationChapterDraft,
} from "@ancient-epics/shared";

import type { BreadcrumbItem } from "../components/BreadcrumbTrail";
import { StagePanel } from "../components/StagePanel";
import { TranslationFormFields } from "./TranslationFormFields";
import type { TranslationFormValues } from "./forms";
import type { ChapterEditorState } from "./utils";
import { ActionButton, AlignedTranslationReview, InputField, Metric, Panel, StatusPill, TextareaField } from "./ui";
import { formatProviderLabel } from "./utils";

export function WorkspaceScreen({
  breadcrumbs,
  activeTranslation,
  validation,
  selectedChapterId,
  currentWorkspaceChapter,
  currentValidationChapter,
  chapterEditor,
  sourceReconstructionMatches,
  chapterIsDirty,
  translationForm,
  isBusy,
  translationMetadataIsDirty,
  onBack,
  onValidate,
  onSelectChapter,
  onSaveMetadata,
  onGenerateCurrentChapter,
  onUpdateChapterEditor,
  onSaveChapter,
}: {
  breadcrumbs: BreadcrumbItem[];
  activeTranslation: AdminTranslationDetail;
  validation: AdminTranslationValidationPayload | null;
  selectedChapterId: string | null;
  currentWorkspaceChapter: TranslationChapterDraft | null;
  currentValidationChapter: AdminTranslationValidationChapter | null;
  chapterEditor: ChapterEditorState | null;
  sourceReconstructionMatches: boolean;
  chapterIsDirty: boolean;
  translationForm: UseFormReturn<TranslationFormValues>;
  isBusy: boolean;
  translationMetadataIsDirty: boolean;
  onBack: () => void;
  onValidate: () => void;
  onSelectChapter: (chapterId: string) => void;
  onSaveMetadata: () => void;
  onGenerateCurrentChapter: () => void;
  onUpdateChapterEditor: (updater: (current: ChapterEditorState) => ChapterEditorState) => void;
  onSaveChapter: () => void;
}) {
  return (
    <StagePanel
      title={activeTranslation.name}
      subtitle="Edit translation metadata, step through chapters, and keep chapter review separate from route navigation."
      breadcrumbs={breadcrumbs}
      backLabel="Back To Translations"
      onBack={onBack}
    >
      <section className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <Panel title="Translation">
          <div className="rounded-2xl border border-border/60 bg-paper/70 p-4 text-sm text-ink/70">
            <StatusPill status={activeTranslation.status} />
            <h3 className="mt-3 font-display text-3xl text-ink">{activeTranslation.name}</h3>
            <p className="mt-2 leading-7">{activeTranslation.description || "No description yet."}</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Metric
                label="Saved"
                value={`${activeTranslation.savedChapterCount}/${activeTranslation.chapterCount}`}
              />
              <Metric label="Draft" value={String(activeTranslation.draftChapterCount)} />
              <Metric label="Errors" value={String(activeTranslation.errorChapterCount)} />
              <Metric label="Provider" value={formatProviderLabel(activeTranslation.provider)} />
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {activeTranslation.chapters.map((chapter) => {
              const issueCount =
                validation?.chapters.find((validationChapter) => validationChapter.chapterId === chapter.chapterId)
                  ?.issues.length ?? 0;

              return (
                <button
                  key={chapter.chapterId}
                  type="button"
                  onClick={() => onSelectChapter(chapter.chapterId)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                    selectedChapterId === chapter.chapterId
                      ? "border-accent bg-accent/10"
                      : "border-border/70 bg-paper/80 hover:border-accent/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{chapter.title}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-accent">{chapter.slug}</p>
                    </div>
                    <StatusPill status={chapter.status} />
                  </div>
                  <p className="mt-2 text-sm text-ink/60">
                    {issueCount > 0 ? `${issueCount} validation issues` : "No flagged issues"}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <ActionButton label="Back To Translations" onClick={onBack} />
            <ActionButton
              label={isBusy ? "Validating..." : "Validate Translation"}
              onClick={onValidate}
              tone="accent"
            />
          </div>
        </Panel>

        <div className="grid gap-6">
          <Panel title="Translation Settings">
            <TranslationFormFields form={translationForm} showSlug promptRows={8} />
            <div className="mt-6 flex flex-wrap gap-3">
              <ActionButton
                label={
                  isBusy && translationMetadataIsDirty
                    ? "Saving..."
                    : translationMetadataIsDirty
                      ? "Save Metadata"
                      : "Metadata Saved"
                }
                onClick={onSaveMetadata}
                disabled={isBusy || !translationMetadataIsDirty}
              />
              <ActionButton
                label={isBusy ? "Generating..." : "Generate Current Chapter"}
                onClick={onGenerateCurrentChapter}
                tone="accent"
                disabled={isBusy || !currentWorkspaceChapter}
              />
            </div>
          </Panel>

          {currentWorkspaceChapter && chapterEditor ? (
            <>
              <Panel title={`Source: ${currentWorkspaceChapter.title}`}>
                <div className="space-y-4">
                  <div className="rounded-2xl border border-border/60 bg-paper/55 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Source Text</p>
                    <p className="mt-3 whitespace-pre-wrap text-base leading-7 text-ink/80">
                      {currentWorkspaceChapter.sourceText}
                    </p>
                  </div>

                  <div
                    className={`rounded-2xl border p-4 text-sm leading-6 ${
                      sourceReconstructionMatches
                        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                        : "border-amber-200 bg-amber-50 text-amber-950"
                    }`}
                  >
                    {sourceReconstructionMatches
                      ? "Current chunks reconstruct the source text exactly."
                      : "Current chunks do not reconstruct the source text exactly. Fix the chunk boundaries before publishing."}
                  </div>

                  {currentValidationChapter?.issues.length ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
                      Last validation run found {currentValidationChapter.issues.length} issue(s) on this chapter.
                    </div>
                  ) : null}

                  {currentWorkspaceChapter.errorMessage ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900">
                      {currentWorkspaceChapter.errorMessage}
                    </div>
                  ) : null}
                </div>
              </Panel>

              <Panel title="Structured Chapter Review">
                <div className="grid gap-3 lg:grid-cols-2">
                  <InputField
                    label="Chapter Title"
                    value={chapterEditor.chapterTitle}
                    onChange={(value) =>
                      onUpdateChapterEditor((current) => ({
                        ...current,
                        chapterTitle: value,
                      }))
                    }
                  />
                  <TextareaField
                    label="Editor Notes"
                    value={chapterEditor.notes}
                    onChange={(value) =>
                      onUpdateChapterEditor((current) => ({
                        ...current,
                        notes: value,
                      }))
                    }
                    rows={3}
                  />
                </div>
                <section className="mt-4 space-y-4">
                  <AlignedTranslationReview
                    chunks={chapterEditor.chunks}
                    onChange={(chunks) =>
                      onUpdateChapterEditor((current) => ({
                        ...current,
                        chunks,
                      }))
                    }
                  />
                </section>
                <div className="mt-6 flex justify-end">
                  <ActionButton
                    label={isBusy && chapterIsDirty ? "Saving..." : chapterIsDirty ? "Save Chapter" : "Chapter Saved"}
                    onClick={onSaveChapter}
                    tone="accent"
                    disabled={isBusy || !chapterIsDirty}
                  />
                </div>
              </Panel>
            </>
          ) : null}
        </div>
      </section>
    </StagePanel>
  );
}
