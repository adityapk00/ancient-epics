export function StatusPanel({
  title,
  body,
  tone = "error",
}: {
  title: string;
  body: string;
  tone?: "error" | "notice";
}) {
  const classes =
    tone === "notice"
      ? "border-emerald-200 bg-emerald-50/90 text-emerald-900"
      : "border-red-200 bg-red-50/90 text-red-900";

  return (
    <section className={`rounded-[24px] p-4 shadow-panel ${classes}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em]">{title}</p>
      <p className="mt-2 text-sm">{body}</p>
    </section>
  );
}
