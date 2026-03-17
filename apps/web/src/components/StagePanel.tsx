import type { ReactNode } from "react";

import { BreadcrumbTrail, type BreadcrumbItem } from "./BreadcrumbTrail";

export function StagePanel({
  title,
  subtitle,
  children,
  backLabel,
  onBack,
  breadcrumbs = [],
  actions,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  backLabel?: string;
  onBack?: () => void;
  breadcrumbs?: BreadcrumbItem[];
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-[32px] border border-border/70 bg-white/82 p-6 shadow-panel backdrop-blur lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 pb-5">
        <div className="space-y-3">
          <BreadcrumbTrail items={breadcrumbs} />
          <h2 className="font-display text-4xl text-ink lg:text-5xl">{title}</h2>
          {subtitle ? <p className="max-w-3xl text-base leading-8 text-ink/72">{subtitle}</p> : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {actions}
          {backLabel && onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="rounded-full border border-border/70 bg-paper/90 px-4 py-2 text-sm font-semibold transition hover:border-accent/50"
            >
              {backLabel}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-6">{children}</div>
    </section>
  );
}
