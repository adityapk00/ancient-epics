import type { AdminTranslationDetail, AdminTranslationValidationPayload } from "@ancient-epics/shared";

import type { BreadcrumbItem } from "../components/BreadcrumbTrail";
import { StagePanel } from "../components/StagePanel";
import { ActionButton, ChapterSideBySidePreview, Metric, Panel, StatusPill } from "./ui";

export function ValidationScreen({
  breadcrumbs,
  activeTranslation,
  validation,
  selectedChapterId,
  validationPreviewChapter,
  isBusy,
  onContinueEditing,
  onRevalidate,
  onPublish,
  onUnpublish,
  onExport,
  onOpenValidationIssue,
  onSelectChapter,
}: {
  breadcrumbs: BreadcrumbItem[];
  activeTranslation: AdminTranslationDetail;
  validation: AdminTranslationValidationPayload;
  selectedChapterId: string | null;
  validationPreviewChapter: AdminTranslationDetail["chapters"][number] | null;
  isBusy: boolean;
  onContinueEditing: () => void;
  onRevalidate: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onExport: () => void;
  onOpenValidationIssue: (issueIndex: number) => void;
  onSelectChapter: (chapterId: string) => void;
}) {
  return (
    <StagePanel
      title="Validation"
      subtitle="Warnings are informational. Errors have to be resolved before publication."
      breadcrumbs={breadcrumbs}
      backLabel="Continue Editing"
      onBack={onContinueEditing}
    >
      <section className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <Panel title="Validation Summary">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">
            {validation.isValid ? "Ready to publish" : "Blocking issues found"}
          </p>
          <p className="mt-3 text-sm leading-6 text-ink/70">
            Warnings are informational. Errors must be fixed before the backend will publish this translation.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-ink/70">
            <Metric label="Chapters" value={String(validation.chapters.length)} />
            <Metric
              label="Errors"
              value={String(validation.issues.filter((issue) => issue.level === "error").length)}
            />
            <Metric
              label="Warnings"
              value={String(validation.issues.filter((issue) => issue.level === "warning").length)}
            />
            <Metric label="Status" value={activeTranslation.status} />
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <ActionButton label="Continue Editing" onClick={onContinueEditing} />
            <ActionButton
              label={isBusy ? "Refreshing..." : "Re-Validate"}
              onClick={onRevalidate}
              tone="accent"
              disabled={isBusy}
            />
            {activeTranslation.status === "published" ? (
              <ActionButton label={isBusy ? "Unpublishing..." : "Unpublish"} onClick={onUnpublish} disabled={isBusy} />
            ) : (
              <ActionButton
                label={isBusy ? "Publishing..." : "Publish Translation"}
                onClick={onPublish}
                disabled={isBusy || !validation.isValid}
              />
            )}
            <ActionButton label="Export Translation JSON" onClick={onExport} />
          </div>
        </Panel>

        <div className="grid gap-6">
          <Panel title="Actionable Issues">
            <div className="space-y-3">
              {validation.issues.length > 0 ? (
                validation.issues.map((issue, index) => (
                  <button
                    key={`${issue.level}-${index}`}
                    type="button"
                    onClick={() => onOpenValidationIssue(index)}
                    className={`w-full rounded-2xl border p-3 text-left text-sm leading-6 ${
                      issue.level === "error"
                        ? "border-red-200 bg-red-50 text-red-800"
                        : "border-amber-200 bg-amber-50 text-amber-900"
                    }`}
                  >
                    <span className="font-semibold">{issue.chapterSlug ?? "Translation"}</span> {issue.message}
                  </button>
                ))
              ) : (
                <p className="text-base leading-7 text-ink/70">No validation issues found.</p>
              )}
            </div>
          </Panel>

          <Panel title="Chapter Checks">
            <div className="grid gap-3 md:grid-cols-2">
              {validation.chapters.map((chapter) => (
                <button
                  key={chapter.chapterId}
                  type="button"
                  onClick={() => onSelectChapter(chapter.chapterId)}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
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
                  <p className="mt-2 text-sm leading-6 text-ink/65">
                    {chapter.issues.length > 0 ? `${chapter.issues.length} issue(s)` : "No issues"}
                  </p>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Side-By-Side Preview">
            <ChapterSideBySidePreview chapter={validationPreviewChapter} />
          </Panel>
        </div>
      </section>
    </StagePanel>
  );
}
