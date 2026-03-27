import { appVersionLabel } from "../lib/version";

export function AppVersionFooter() {
  return (
    <footer className="pt-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-ink/45">
      {appVersionLabel}
    </footer>
  );
}
