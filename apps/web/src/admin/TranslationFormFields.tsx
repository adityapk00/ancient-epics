import { useWatch, type UseFormReturn } from "react-hook-form";

import { ACCESS_LEVEL_OPTIONS, type TranslationFormValues } from "./forms";
import { FormInputField, FormSelectField, FormTextareaField, TranslationAiSettingsRow } from "./ui";

export function TranslationFormFields({
  form,
  showSlug,
  promptRows = 8,
}: {
  form: UseFormReturn<TranslationFormValues>;
  showSlug: boolean;
  promptRows?: number;
}) {
  const provider = useWatch({ control: form.control, name: "provider" });
  const model = useWatch({ control: form.control, name: "model" });
  const contextBeforeChapterCount = useWatch({ control: form.control, name: "contextBeforeChapterCount" });
  const contextAfterChapterCount = useWatch({ control: form.control, name: "contextAfterChapterCount" });
  const thinkingLevel = useWatch({ control: form.control, name: "thinkingLevel" });

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <FormInputField label="Translation Name" registration={form.register("title")} />
        {showSlug ? <FormInputField label="Slug" registration={form.register("slug")} /> : null}
        <FormInputField label="Description" registration={form.register("description")} />
        <FormSelectField
          label="Reader Access"
          registration={form.register("accessLevel")}
          options={[...ACCESS_LEVEL_OPTIONS]}
        />
      </div>
      <div className="mt-4">
        <TranslationAiSettingsRow
          provider={provider}
          onProviderChange={(value) => form.setValue("provider", value, { shouldDirty: true })}
          model={model}
          onModelChange={(value) => form.setValue("model", value, { shouldDirty: true })}
          contextBeforeChapterCount={contextBeforeChapterCount}
          onContextBeforeChapterCountChange={(value) =>
            form.setValue("contextBeforeChapterCount", value, { shouldDirty: true })
          }
          contextAfterChapterCount={contextAfterChapterCount}
          onContextAfterChapterCountChange={(value) =>
            form.setValue("contextAfterChapterCount", value, { shouldDirty: true })
          }
          thinkingLevel={thinkingLevel}
          onThinkingLevelChange={(value) => form.setValue("thinkingLevel", value, { shouldDirty: true })}
        />
      </div>
      <div className="mt-4">
        <FormTextareaField label="Prompt" registration={form.register("prompt")} rows={promptRows} />
      </div>
    </>
  );
}
