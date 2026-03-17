import type { UseFormReturn } from "react-hook-form";

import type { EditBookFormValues } from "./forms";
import { ActionButton, FormInputField, FormTextareaField } from "./ui";

export function EditBookDialog({
  form,
  isBusy,
  onClose,
  onSave,
}: {
  form: UseFormReturn<EditBookFormValues>;
  isBusy: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const title = form.watch("title");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 px-4 py-6">
      <div className="w-full max-w-2xl rounded-[32px] border border-border/70 bg-white p-6 shadow-panel">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display text-4xl text-ink">Edit Book</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border/70 px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent/50"
          >
            Close
          </button>
        </div>
        <div className="mt-6 grid gap-4">
          <FormInputField label="Title" registration={form.register("title")} />
          <FormInputField label="Author" registration={form.register("author")} />
          <FormInputField label="Original Language" registration={form.register("originalLanguage")} />
          <FormTextareaField label="Description" registration={form.register("description")} rows={6} />
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <ActionButton label="Cancel" onClick={onClose} disabled={isBusy} />
          <ActionButton
            label={isBusy ? "Saving..." : "Save Metadata"}
            onClick={onSave}
            tone="accent"
            disabled={isBusy || !title.trim()}
          />
        </div>
      </div>
    </div>
  );
}
