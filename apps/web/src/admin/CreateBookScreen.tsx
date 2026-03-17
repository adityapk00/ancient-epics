import { useWatch, type UseFormReturn } from "react-hook-form";

import type { BreadcrumbItem } from "../components/BreadcrumbTrail";
import { StagePanel } from "../components/StagePanel";
import type { SplitChapterInput } from "../lib/chapter-splitting";
import type { CreateBookFormValues } from "./forms";
import {
  ActionButton,
  FormInputField,
  FormTextareaField,
  InputField,
  MiniButton,
  Panel,
  SegmentedControl,
  TextareaField,
} from "./ui";

export function CreateBookScreen({
  form,
  breadcrumbs,
  stagedChapters,
  chapterPreviewCount,
  isBusy,
  onBack,
  onSeedStageFromPreview,
  onUpdateStagedChapter,
  onMoveStagedChapter,
  onDeleteStagedChapter,
  onSplitStagedChapter,
  onMergeStagedChapter,
  onCreateBook,
}: {
  form: UseFormReturn<CreateBookFormValues>;
  breadcrumbs: BreadcrumbItem[];
  stagedChapters: Array<SplitChapterInput & { id: string }>;
  chapterPreviewCount: number;
  isBusy: boolean;
  onBack: () => void;
  onSeedStageFromPreview: () => void;
  onUpdateStagedChapter: (index: number, key: keyof SplitChapterInput, value: string | null) => void;
  onMoveStagedChapter: (index: number, direction: -1 | 1) => void;
  onDeleteStagedChapter: (index: number) => void;
  onSplitStagedChapter: (index: number) => void;
  onMergeStagedChapter: (index: number) => void;
  onCreateBook: () => void;
}) {
  const splitMode = useWatch({ control: form.control, name: "splitMode" });
  const title = useWatch({ control: form.control, name: "title" });

  return (
    <StagePanel
      title="Create Book"
      subtitle="Use the URL to stay in the creation flow while the source text and staged chapters live in a managed form."
      breadcrumbs={breadcrumbs}
      backLabel="Back To Books"
      onBack={onBack}
    >
      <section className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <Panel title="Book Details">
          <div className="space-y-4">
            <FormInputField label="Title" registration={form.register("title")} />
            <FormInputField label="Author" registration={form.register("author")} />
            <FormInputField label="Original Language" registration={form.register("originalLanguage")} />
            <FormTextareaField label="Description" registration={form.register("description")} rows={5} />
            <SegmentedControl
              label="Chapter Split"
              value={splitMode}
              options={[
                { value: "heading", label: "Heading regex" },
                { value: "delimiter", label: "Delimiter" },
                { value: "single", label: "Single chapter" },
              ]}
              onChange={(value) =>
                form.setValue("splitMode", value as CreateBookFormValues["splitMode"], {
                  shouldDirty: true,
                })
              }
            />
            {splitMode === "heading" ? (
              <FormInputField label="Heading Regex" registration={form.register("headingPattern")} />
            ) : null}
            {splitMode === "delimiter" ? (
              <FormInputField label="Delimiter" registration={form.register("delimiter")} />
            ) : null}
            <ActionButton label="Back To Books" onClick={onBack} />
          </div>
        </Panel>

        <div className="grid gap-6">
          <Panel title="Paste Source Text">
            <FormTextareaField
              label="Full Text"
              registration={form.register("rawText")}
              rows={16}
              placeholder="Paste the full source text here."
            />
            <div className="mt-4 flex flex-wrap gap-3">
              <ActionButton
                label="Load Auto-Split Into Editor"
                onClick={onSeedStageFromPreview}
                tone="accent"
                disabled={chapterPreviewCount === 0}
              />
              <span className="text-sm text-ink/60">{chapterPreviewCount} chapter split(s) detected.</span>
            </div>
          </Panel>

          <Panel title="Editable Chapter Staging">
            <div className="space-y-4">
              {stagedChapters.map((chapter, index) => (
                <div key={chapter.id} className="rounded-2xl border border-border/60 bg-paper/80 p-4">
                  <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
                    <InputField
                      label={`Chapter ${index + 1} Title`}
                      value={chapter.title}
                      onChange={(value) => onUpdateStagedChapter(index, "title", value)}
                    />
                    <InputField
                      label="Slug"
                      value={chapter.slug}
                      onChange={(value) => onUpdateStagedChapter(index, "slug", value)}
                    />
                    <div className="flex flex-wrap items-end gap-2">
                      <MiniButton label="Up" onClick={() => onMoveStagedChapter(index, -1)} disabled={index === 0} />
                      <MiniButton
                        label="Down"
                        onClick={() => onMoveStagedChapter(index, 1)}
                        disabled={index === stagedChapters.length - 1}
                      />
                      <MiniButton label="Split" onClick={() => onSplitStagedChapter(index)} />
                      <MiniButton label="Merge" onClick={() => onMergeStagedChapter(index)} disabled={index === 0} />
                      <MiniButton label="Delete" onClick={() => onDeleteStagedChapter(index)} />
                    </div>
                  </div>
                  <div className="mt-4">
                    <TextareaField
                      label="Source Text"
                      value={chapter.sourceText}
                      onChange={(value) => onUpdateStagedChapter(index, "sourceText", value)}
                      rows={8}
                    />
                  </div>
                </div>
              ))}
              {stagedChapters.length === 0 ? (
                <p className="text-base leading-7 text-ink/65">
                  Generate an auto-split preview, then adjust the staged chapters before creating the book.
                </p>
              ) : null}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <ActionButton
                label={isBusy ? "Saving..." : "Create Book"}
                onClick={onCreateBook}
                tone="accent"
                disabled={isBusy || !title.trim() || stagedChapters.length === 0}
              />
            </div>
          </Panel>
        </div>
      </section>
    </StagePanel>
  );
}
