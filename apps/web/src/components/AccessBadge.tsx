import type { AccessLevel } from "@ancient-epics/shared";

export function AccessBadge({ accessLevel }: { accessLevel: AccessLevel }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
        accessLevel === "public"
          ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border border-border/70 bg-white/75 text-ink/65"
      }`}
    >
      {accessLevel === "public" ? "Free To Read" : "Free Account"}
    </span>
  );
}
