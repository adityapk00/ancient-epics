import type { AdminAnalyticsPayload } from "@ancient-epics/shared";

import type { BreadcrumbItem } from "../components/BreadcrumbTrail";
import { EmptyState } from "../components/EmptyState";
import { StagePanel } from "../components/StagePanel";
import { Metric, Panel } from "./ui";

export function AnalyticsScreen({
  analytics,
  breadcrumbs,
}: {
  analytics: AdminAnalyticsPayload | null;
  breadcrumbs: BreadcrumbItem[];
}) {
  return (
    <StagePanel
      title="Analytics"
      subtitle="A simple 30-day view of signups and reading activity, grouped by day, book, translation, and country."
      breadcrumbs={breadcrumbs}
    >
      {!analytics ? (
        <Panel title="Analytics">
          <EmptyState body="Analytics have not loaded yet." />
        </Panel>
      ) : (
        <div className="grid gap-6">
          <Panel title="Overview">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Metric label="Signups" value={String(analytics.overview.signups)} />
              <Metric label="Book Views" value={String(analytics.overview.bookViews)} />
              <Metric label="Chapter Views" value={String(analytics.overview.chapterViews)} />
              <Metric label="Translation Views" value={String(analytics.overview.translationViews)} />
              <Metric label="Countries" value={String(analytics.overview.uniqueCountries)} />
            </div>
          </Panel>

          <section className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
            <Panel title={`Daily Activity (${analytics.days} Days)`}>
              {analytics.daily.length === 0 ? (
                <EmptyState body="No analytics events have been recorded yet." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm text-ink/78">
                    <thead>
                      <tr className="border-b border-border/60 text-xs uppercase tracking-[0.18em] text-accent">
                        <th className="py-3 pr-4">Date</th>
                        <th className="py-3 pr-4">Signups</th>
                        <th className="py-3 pr-4">Books</th>
                        <th className="py-3 pr-4">Chapters</th>
                        <th className="py-3">Translations</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.daily.map((day) => (
                        <tr key={day.date} className="border-b border-border/40 last:border-b-0">
                          <td className="py-3 pr-4 font-medium text-ink">{formatDate(day.date)}</td>
                          <td className="py-3 pr-4">{day.signups}</td>
                          <td className="py-3 pr-4">{day.bookViews}</td>
                          <td className="py-3 pr-4">{day.chapterViews}</td>
                          <td className="py-3">{day.translationViews}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel title="Top Countries">
              {analytics.topCountries.length === 0 ? (
                <EmptyState body="No country-level analytics have been recorded yet." />
              ) : (
                <div className="space-y-3">
                  {analytics.topCountries.map((country) => (
                    <div key={country.country} className="rounded-[22px] border border-border/60 bg-paper/70 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="font-semibold text-ink">{country.country}</h3>
                        <span className="text-xs uppercase tracking-[0.18em] text-accent">
                          {country.signups + country.bookViews + country.chapterViews + country.translationViews} events
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <Metric label="Signups" value={String(country.signups)} />
                        <Metric label="Books" value={String(country.bookViews)} />
                        <Metric label="Chapters" value={String(country.chapterViews)} />
                        <Metric label="Translations" value={String(country.translationViews)} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <Panel title="Top Books">
              {analytics.topBooks.length === 0 ? (
                <EmptyState body="No book views have been recorded yet." />
              ) : (
                <div className="space-y-3">
                  {analytics.topBooks.map((book, index) => (
                    <div
                      key={book.bookSlug}
                      className="flex items-center justify-between gap-4 rounded-[22px] border border-border/60 bg-paper/70 px-4 py-3"
                    >
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">#{index + 1}</p>
                        <p className="mt-1 font-semibold text-ink">{book.title}</p>
                        <p className="text-xs text-ink/55">{book.bookSlug}</p>
                      </div>
                      <span className="text-lg font-semibold text-ink">{book.viewCount}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Top Translations">
              {analytics.topTranslations.length === 0 ? (
                <EmptyState body="No translation views have been recorded yet." />
              ) : (
                <div className="space-y-3">
                  {analytics.topTranslations.map((translation, index) => (
                    <div
                      key={`${translation.bookSlug}:${translation.translationSlug}`}
                      className="flex items-center justify-between gap-4 rounded-[22px] border border-border/60 bg-paper/70 px-4 py-3"
                    >
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">#{index + 1}</p>
                        <p className="mt-1 font-semibold text-ink">{translation.translationName}</p>
                        <p className="text-xs text-ink/55">
                          {translation.bookSlug} / {translation.translationSlug}
                        </p>
                      </div>
                      <span className="text-lg font-semibold text-ink">{translation.viewCount}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </section>
        </div>
      )}
    </StagePanel>
  );
}

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
