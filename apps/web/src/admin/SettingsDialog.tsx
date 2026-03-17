import type { UseFormReturn } from "react-hook-form";

import type { SettingsFormValues } from "./forms";
import { PROVIDER_OPTIONS } from "./forms";
import { ActionButton, FormInputField, FormSelectField, FormTextareaField } from "./ui";

export function SettingsDialog({
  form,
  isBusy,
  onClose,
  onSave,
}: {
  form: UseFormReturn<SettingsFormValues>;
  isBusy: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-ink/35 px-4 py-6">
      <div className="w-full max-w-xl rounded-[32px] border border-border/70 bg-white p-6 shadow-panel">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display text-4xl text-ink">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border/70 px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent/50"
          >
            Close
          </button>
        </div>
        <div className="mt-6 space-y-6">
          <section className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Credentials</p>
            <FormInputField
              label="OpenRouter API Key"
              registration={form.register("openRouterApiKey")}
              type="password"
            />
            <FormInputField
              label="Google Gemini API Key"
              registration={form.register("googleApiKey")}
              type="password"
            />
          </section>
          <section className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Generation Defaults</p>
            <FormSelectField
              label="Default Provider"
              registration={form.register("provider")}
              options={PROVIDER_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
            <FormInputField label="Default Model" registration={form.register("model")} />
            <FormTextareaField label="Default Prompt" registration={form.register("prompt")} rows={10} />
          </section>
          <ActionButton
            label={isBusy ? "Saving..." : "Save Settings"}
            onClick={onSave}
            tone="accent"
            disabled={isBusy}
          />
        </div>
      </div>
    </div>
  );
}
