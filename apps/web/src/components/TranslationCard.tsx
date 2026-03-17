import type { ReactNode } from "react";

export function TranslationCard({
  title,
  description,
  eyebrow,
  badges,
  metadata,
  metrics,
  hint,
  onOpen,
  actions,
}: {
  title: string;
  description: string;
  eyebrow?: ReactNode;
  badges?: ReactNode;
  metadata?: ReactNode;
  metrics?: ReactNode;
  hint?: ReactNode;
  onOpen?: () => void;
  actions?: ReactNode;
}) {
  const content = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{eyebrow}</p> : null}
        {badges}
      </div>
      <h3 className="mt-3 font-display text-4xl text-ink">{title}</h3>
      <p className="mt-4 text-base leading-8 text-ink/74">{description}</p>
      {metadata ? (
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink/65">
          {metadata}
        </div>
      ) : null}
      {metrics ? <div className="mt-4">{metrics}</div> : null}
      {hint ? <div className="mt-4 text-sm font-semibold text-accent">{hint}</div> : null}
      {actions ? <div className="mt-5 flex flex-wrap gap-2">{actions}</div> : null}
    </>
  );

  if (onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="rounded-[28px] border border-border/70 bg-paper/72 p-6 text-left transition hover:border-accent/50 hover:bg-white"
      >
        {content}
      </button>
    );
  }

  return <div className="rounded-[28px] border border-border/70 bg-paper/72 p-6">{content}</div>;
}
