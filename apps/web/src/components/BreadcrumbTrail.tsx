export type BreadcrumbItem = {
  label: string;
  isCurrent: boolean;
  onClick?: (() => void) | null;
};

export function BreadcrumbTrail({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-ink/60">
      {items.map((crumb, index) => (
        <div key={`${crumb.label}-${index}`} className="flex items-center gap-2">
          {index > 0 ? <span className="text-ink/35">/</span> : null}
          {crumb.isCurrent || !crumb.onClick ? (
            <span className={crumb.isCurrent ? "font-semibold text-ink" : undefined}>{crumb.label}</span>
          ) : (
            <button type="button" onClick={crumb.onClick} className="transition hover:text-ink">
              {crumb.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
