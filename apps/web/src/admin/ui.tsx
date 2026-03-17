import type { ReactNode } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";

import type { AiProvider, TranslationChapterDraft } from "@ancient-epics/shared";

import { PROVIDER_OPTIONS, THINKING_LEVEL_OPTIONS } from "./forms";

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[28px] border border-border/70 bg-white/80 p-6 shadow-panel backdrop-blur">
      <h2 className="font-display text-3xl text-ink">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function FormInputField({
  label,
  registration,
  type = "text",
  placeholder,
}: {
  label: string;
  registration: UseFormRegisterReturn;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{label}</span>
      <input
        type={type}
        placeholder={placeholder}
        {...registration}
        className="rounded-2xl border border-border/70 bg-paper/70 px-4 py-3 text-base text-ink outline-none transition focus:border-accent"
      />
    </label>
  );
}

export function FormTextareaField({
  label,
  registration,
  rows,
  placeholder,
}: {
  label: string;
  registration: UseFormRegisterReturn;
  rows: number;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{label}</span>
      <textarea
        rows={rows}
        placeholder={placeholder}
        {...registration}
        className="rounded-2xl border border-border/70 bg-paper/70 px-4 py-3 text-base leading-7 text-ink outline-none transition focus:border-accent"
      />
    </label>
  );
}

export function FormSelectField({
  label,
  registration,
  options,
}: {
  label: string;
  registration: UseFormRegisterReturn;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{label}</span>
      <select
        {...registration}
        className="rounded-2xl border border-border/70 bg-paper/70 px-4 py-3 text-base text-ink outline-none transition focus:border-accent"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function InputField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="rounded-2xl border border-border/70 bg-paper/70 px-4 py-3 text-base text-ink outline-none transition focus:border-accent"
      />
    </label>
  );
}

export function TextareaField({
  label,
  value,
  onChange,
  rows,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{label}</span>
      <textarea
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="rounded-2xl border border-border/70 bg-paper/70 px-4 py-3 text-base leading-7 text-ink outline-none transition focus:border-accent"
      />
    </label>
  );
}

export function CompactInputField({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`grid gap-2 ${className ?? ""}`.trim()}>
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="rounded-xl border border-border/70 bg-white/85 px-3 py-2 text-sm text-ink outline-none transition focus:border-accent"
      />
    </label>
  );
}

export function SegmentedControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              value === option.value
                ? "bg-accent text-paper"
                : "border border-border/70 bg-paper/70 text-ink hover:border-accent/40"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ActionButton({
  label,
  onClick,
  disabled,
  tone = "default",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "accent";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full px-5 py-3 text-sm font-semibold transition ${
        tone === "accent"
          ? "bg-accent text-paper hover:bg-accent/90"
          : "border border-border/80 bg-paper/90 text-ink hover:border-accent/50"
      } disabled:cursor-not-allowed disabled:opacity-55`}
    >
      {label}
    </button>
  );
}

export function MiniButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-border/70 px-3 py-2 text-xs font-semibold text-ink disabled:opacity-40"
    >
      {label}
    </button>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-white/70 p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent/80">{label}</p>
      <p className="mt-1 text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === "saved"
      ? "bg-emerald-100 text-emerald-800"
      : status === "published"
        ? "bg-sky-100 text-sky-800"
        : status === "draft"
          ? "bg-amber-100 text-amber-800"
          : status === "error"
            ? "bg-red-100 text-red-800"
            : "bg-stone-200 text-stone-700";

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${tone}`}>{status}</span>
  );
}

export function TranslationAiSettingsRow({
  provider,
  onProviderChange,
  model,
  onModelChange,
  contextBeforeChapterCount,
  onContextBeforeChapterCountChange,
  contextAfterChapterCount,
  onContextAfterChapterCountChange,
  thinkingLevel,
  onThinkingLevelChange,
}: {
  provider: AiProvider;
  onProviderChange: (value: AiProvider) => void;
  model: string;
  onModelChange: (value: string) => void;
  contextBeforeChapterCount: string;
  onContextBeforeChapterCountChange: (value: string) => void;
  contextAfterChapterCount: string;
  onContextAfterChapterCountChange: (value: string) => void;
  thinkingLevel: string;
  onThinkingLevelChange: (value: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-paper/70 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">AI Settings</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.8fr)_repeat(3,minmax(0,1fr))]">
        <div className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Provider</span>
          <CompactSelect
            value={provider}
            onChange={(value) => onProviderChange(value as AiProvider)}
            options={PROVIDER_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            ariaLabel="Provider"
          />
        </div>
        <CompactInputField label="Model" value={model} onChange={onModelChange} className="xl:col-span-2" />
        <CompactInputField
          label="Context Before"
          value={contextBeforeChapterCount}
          onChange={onContextBeforeChapterCountChange}
        />
        <CompactInputField
          label="Context After"
          value={contextAfterChapterCount}
          onChange={onContextAfterChapterCountChange}
        />
        <div className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Thinking Level</span>
          <CompactSelect
            value={thinkingLevel}
            onChange={onThinkingLevelChange}
            options={THINKING_LEVEL_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            ariaLabel="Thinking level"
          />
        </div>
      </div>
    </div>
  );
}

export function AlignedTranslationReview({
  chunks,
  onChange,
}: {
  chunks: Array<{
    originalText: string;
    translatedText: string;
    type: "prose" | "verse";
  }>;
  onChange: (
    chunks: Array<{
      originalText: string;
      translatedText: string;
      type: "prose" | "verse";
    }>,
  ) => void;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-paper/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Aligned Translation Review</p>
        <MiniButton
          label="Add Chunk"
          onClick={() =>
            onChange([
              ...chunks,
              {
                originalText: "",
                translatedText: "",
                type: "prose",
              },
            ])
          }
        />
      </div>
      <div className="mt-3 space-y-3">
        {chunks.map((chunk, index) => (
          <div
            key={`translation-${index}`}
            className="grid gap-4 rounded-xl border border-border/50 bg-white/45 p-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]"
          >
            <div className="min-w-0 border-r border-border/35 pr-4 xl:pr-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent/80">Source</p>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent/75">T{index + 1}</p>
              </div>
              <textarea
                rows={Math.max(5, chunk.originalText.split("\n").length)}
                value={chunk.originalText}
                onChange={(event) =>
                  onChange(
                    chunks.map((entry, chunkIndex) =>
                      chunkIndex === index ? { ...entry, originalText: event.target.value } : entry,
                    ),
                  )
                }
                placeholder="Original text"
                className="mt-3 w-full rounded-xl border border-border/60 bg-paper/65 px-3 py-2 text-base leading-7 text-ink outline-none transition focus:border-accent"
              />
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CompactSelect
                  value={chunk.type}
                  onChange={(value) =>
                    onChange(
                      chunks.map((entry, chunkIndex) =>
                        chunkIndex === index ? { ...entry, type: value as "prose" | "verse" } : entry,
                      ),
                    )
                  }
                  options={[
                    { value: "prose", label: "Prose" },
                    { value: "verse", label: "Verse" },
                  ]}
                  ariaLabel={`Chunk type for translation ${index + 1}`}
                />
                <MiniButton
                  label="Add Below"
                  onClick={() =>
                    onChange([
                      ...chunks.slice(0, index + 1),
                      {
                        originalText: "",
                        translatedText: "",
                        type: chunk.type,
                      },
                      ...chunks.slice(index + 1),
                    ])
                  }
                />
                <MiniButton
                  label="Delete"
                  onClick={() => onChange(chunks.filter((_, chunkIndex) => chunkIndex !== index))}
                  disabled={chunks.length === 1}
                />
              </div>

              <textarea
                rows={5}
                value={chunk.translatedText}
                onChange={(event) =>
                  onChange(
                    chunks.map((entry, chunkIndex) =>
                      chunkIndex === index ? { ...entry, translatedText: event.target.value } : entry,
                    ),
                  )
                }
                placeholder="Translated text"
                className="mt-3 w-full rounded-xl border border-border/60 bg-paper/65 px-3 py-2 text-base leading-7 text-ink outline-none transition focus:border-accent"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CompactSelect({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  ariaLabel: string;
}) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-full border border-border/70 bg-paper/60 px-3 py-1.5 text-sm font-semibold text-ink outline-none transition focus:border-accent"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function ChapterSideBySidePreview({ chapter }: { chapter: TranslationChapterDraft | null }) {
  if (!chapter?.content || chapter.content.chunks.length === 0) {
    return <p className="text-base leading-7 text-ink/70">No translated content saved for this chapter yet.</p>;
  }

  return (
    <div className="divide-y divide-border/35">
      <div className="grid grid-cols-2 gap-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-accent md:gap-8">
        <div>Source</div>
        <div>Translation</div>
      </div>
      {chapter.content.chunks.map((chunk) => (
        <div key={chunk.id} className="grid grid-cols-2 gap-4 py-4 md:gap-8">
          <div>
            <p className="whitespace-pre-wrap text-lg leading-8 text-ink/80">{chunk.originalText}</p>
          </div>
          <div>
            <p className="whitespace-pre-wrap text-lg leading-8 text-ink/80">{chunk.translatedText}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
