import { useEffect, useState } from "react";

import type {
  BookDetail,
  BookSummary,
  ChapterPayload,
  TranslationPayload,
} from "@ancient-epics/shared";

import { api } from "./lib/api";

interface AppState {
  books: BookSummary[];
  bookDetail: BookDetail | null;
  chapter: ChapterPayload | null;
  translation: TranslationPayload | null;
  environment: string;
}

const initialState: AppState = {
  books: [],
  bookDetail: null,
  chapter: null,
  translation: null,
  environment: "unknown",
};

export default function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [health, booksPayload] = await Promise.all([
          api.health(),
          api.listBooks(),
        ]);
        const firstBook = booksPayload.books[0];

        if (!firstBook) {
          setState({
            ...initialState,
            environment: health.environment,
            books: [],
          });
          return;
        }

        const bookDetail = await api.getBook(firstBook.slug);
        const firstChapter = bookDetail.chapters[0];
        const firstTranslation = bookDetail.translations[0];

        if (!firstChapter || !firstTranslation) {
          setState({
            books: booksPayload.books,
            bookDetail,
            chapter: null,
            translation: null,
            environment: health.environment,
          });
          return;
        }

        const [chapter, translation] = await Promise.all([
          api.getChapter(firstBook.slug, firstChapter.slug),
          api.getTranslation(
            firstBook.slug,
            firstChapter.slug,
            firstTranslation.slug,
          ),
        ]);

        setState({
          books: booksPayload.books,
          bookDetail,
          chapter,
          translation,
          environment: health.environment,
        });
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load app bootstrap data.",
        );
      } finally {
        setIsLoading(false);
      }
    }

    void load();
  }, []);

  const rows = state.chapter?.original.chunks ?? [];
  const translationChunks = state.translation?.content.chunks ?? {};

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-10 px-6 py-10 lg:px-10">
        <section className="grid gap-6 rounded-[32px] border border-border/70 bg-white/85 p-8 shadow-panel backdrop-blur md:grid-cols-[1.5fr_1fr]">
          <div className="space-y-6">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">
              Phase 0 foundation
            </p>
            <div className="space-y-4">
              <h1 className="font-display text-5xl leading-tight text-ink sm:text-6xl">
                Ancient Epics is wired for Cloudflare-first reading flows.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-ink/75">
                This scaffold validates the monorepo, shared contracts, Worker
                API, D1 metadata, and R2-backed chapter retrieval with one
                seeded sample chapter.
              </p>
            </div>
          </div>

          <div className="grid gap-4 rounded-[28px] bg-ink p-6 text-paper">
            <Metric label="Environment" value={state.environment} />
            <Metric
              label="Books available"
              value={String(state.books.length)}
            />
            <Metric
              label="Seeded chapter"
              value={state.chapter?.chapter.title ?? "Pending"}
            />
            <Metric
              label="Default translation"
              value={state.translation?.translation.name ?? "Pending"}
            />
          </div>
        </section>

        {isLoading ? (
          <Panel title="Loading">
            Connecting the web app to the local Worker.
          </Panel>
        ) : null}
        {error ? <Panel title="Bootstrap error">{error}</Panel> : null}

        <section className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Panel title="Library snapshot">
            <div className="space-y-4">
              {state.books.map((book) => (
                <article
                  key={book.id}
                  className="rounded-2xl border border-border/80 bg-paper p-4"
                >
                  <p className="text-sm uppercase tracking-[0.18em] text-accent">
                    {book.originalLanguage}
                  </p>
                  <h2 className="mt-2 font-display text-2xl text-ink">
                    {book.title}
                  </h2>
                  <p className="mt-1 text-sm text-ink/70">{book.author}</p>
                  <p className="mt-3 text-sm leading-7 text-ink/75">
                    {book.description}
                  </p>
                </article>
              ))}
            </div>
          </Panel>

          <Panel title="Aligned reader sample">
            <div className="grid gap-2">
              <div className="hidden border-b border-border/60 pb-3 text-xs font-semibold uppercase tracking-[0.2em] text-accent md:grid md:grid-cols-2 md:gap-8">
                <p>Original</p>
                <p>Translation</p>
              </div>

              <div className="divide-y divide-border/35">
                {rows.map((chunk) => (
                  <div
                    key={chunk.id}
                    className="grid gap-4 py-4 md:grid-cols-2 md:gap-8"
                  >
                    <div>
                      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-accent md:hidden">
                        Original
                      </p>
                      <p className="mt-2 font-display text-2xl leading-9 text-ink md:mt-0">
                        <span className="mr-3 align-top font-sans text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-accent/85">
                          {chunk.id}
                        </span>
                        {chunk.text}
                      </p>
                    </div>
                    <div>
                      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-accent md:hidden">
                        Translation
                      </p>
                      <p className="mt-2 text-lg leading-8 text-ink/80 md:mt-0">
                        {translationChunks[chunk.id] ??
                          "Translation missing for this chunk."}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-paper/15 bg-paper/5 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-paper/60">
        {label}
      </p>
      <p className="mt-3 text-lg font-semibold text-paper">{value}</p>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-border/70 bg-white/80 p-6 shadow-panel backdrop-blur">
      <h2 className="font-display text-3xl text-ink">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}
