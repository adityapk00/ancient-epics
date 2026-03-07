import { useEffect, useState } from "react";

import {
  APP_SETTING_KEYS,
  type AdminIngestionBootstrapPayload,
  type AdminIngestionSessionDetail,
  type BookDetail,
  type BookSummary,
  type ChapterPayload,
  type TranslationPayload,
} from "@ancient-epics/shared";

import {
  splitSourceTextIntoChapters,
  type ChapterSplitMode,
} from "./lib/chapter-splitting";
import { api } from "./lib/api";

interface ReaderState {
  books: BookSummary[];
  bookDetail: BookDetail | null;
  chapter: ChapterPayload | null;
  translation: TranslationPayload | null;
  environment: string;
}

type ViewMode = "admin" | "reader";
type SourceMode = "paste" | "existing_story";

const initialReaderState: ReaderState = {
  books: [],
  bookDetail: null,
  chapter: null,
  translation: null,
  environment: "unknown",
};

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>("admin");
  const [readerState, setReaderState] = useState<ReaderState>(initialReaderState);
  const [adminBootstrap, setAdminBootstrap] =
    useState<AdminIngestionBootstrapPayload | null>(null);
  const [activeSession, setActiveSession] =
    useState<AdminIngestionSessionDetail | null>(null);
  const [selectedChapterIndex, setSelectedChapterIndex] = useState(0);
  const [editedRawResponse, setEditedRawResponse] = useState("");

  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [defaultApiKey, setDefaultApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState("openai/gpt-4o-mini");
  const [defaultPrompt, setDefaultPrompt] = useState("");

  const [sourceMode, setSourceMode] = useState<SourceMode>("paste");
  const [newSessionTitle, setNewSessionTitle] = useState("Fresh Translation Draft");
  const [selectedSourceBookSlug, setSelectedSourceBookSlug] = useState("");
  const [rawSourceText, setRawSourceText] = useState("");
  const [splitMode, setSplitMode] = useState<ChapterSplitMode>("heading");
  const [headingPattern, setHeadingPattern] = useState(
    "^(book|chapter|canto|scroll)\\b.*$",
  );
  const [delimiter, setDelimiter] = useState("\n\n\n");

  const [sessionEditorTitle, setSessionEditorTitle] = useState("");
  const [sessionEditorModel, setSessionEditorModel] = useState("");
  const [sessionEditorPrompt, setSessionEditorPrompt] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const [health, booksPayload, adminPayload] = await Promise.all([
          api.health(),
          api.listBooks(),
          api.getAdminIngestionBootstrap(),
        ]);

        setAdminBootstrap(adminPayload);
        setDefaultApiKey(
          adminPayload.settings[APP_SETTING_KEYS.OPENROUTER_API_KEY] ?? "",
        );
        setDefaultModel(
          adminPayload.settings[APP_SETTING_KEYS.ADMIN_INGESTION_MODEL] ??
            adminPayload.settings[APP_SETTING_KEYS.DEFAULT_TRANSLATION_MODEL] ??
            "openai/gpt-4o-mini",
        );
        setDefaultPrompt(
          adminPayload.settings[APP_SETTING_KEYS.ADMIN_INGESTION_PROMPT] ?? "",
        );
        setSelectedSourceBookSlug(adminPayload.books[0]?.slug ?? "");

        const firstBook = booksPayload.books[0];

        if (!firstBook) {
          setReaderState({
            ...initialReaderState,
            environment: health.environment,
          });
        } else {
          const bookDetail = await api.getBook(firstBook.slug);
          const firstChapter = bookDetail.chapters[0];
          const firstTranslation = bookDetail.translations[0];

          if (!firstChapter || !firstTranslation) {
            setReaderState({
              books: booksPayload.books,
              bookDetail,
              chapter: null,
              translation: null,
              environment: health.environment,
            });
          } else {
            const [chapter, translation] = await Promise.all([
              api.getChapter(firstBook.slug, firstChapter.slug),
              api.getTranslation(
                firstBook.slug,
                firstChapter.slug,
                firstTranslation.slug,
              ),
            ]);

            setReaderState({
              books: booksPayload.books,
              bookDetail,
              chapter,
              translation,
              environment: health.environment,
            });
          }
        }

        if (adminPayload.sessions[0]) {
          const session = await api.getAdminIngestionSession(
            adminPayload.sessions[0].id,
          );
          syncSessionState(session);
        }
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load the application.",
        );
      } finally {
        setIsLoading(false);
      }
    }

    void load();
  }, []);

  useEffect(() => {
    const currentChapter = activeSession?.chapters[selectedChapterIndex] ?? null;
    setEditedRawResponse(currentChapter?.rawResponse ?? "");
  }, [activeSession, selectedChapterIndex]);

  const sourceSplitPreview =
    sourceMode === "paste"
      ? splitSourceTextIntoChapters({
          rawText: rawSourceText,
          splitMode,
          headingPattern,
          delimiter,
        })
      : [];

  const currentSessionChapter = activeSession?.chapters[selectedChapterIndex] ?? null;
  const readerOriginalChunks = readerState.chapter?.original.chunks ?? [];
  const readerTranslationChunks = readerState.translation?.content.chunks ?? [];
  const readerOriginalChunkMap = new Map(
    readerOriginalChunks.map((chunk) => [chunk.id, chunk]),
  );

  async function refreshAdminBootstrap(preferredSessionId?: string) {
    const payload = await api.getAdminIngestionBootstrap();
    setAdminBootstrap(payload);

    if (preferredSessionId) {
      const session = await api.getAdminIngestionSession(preferredSessionId);
      syncSessionState(session);
      return;
    }

    if (!activeSession && payload.sessions[0]) {
      const session = await api.getAdminIngestionSession(payload.sessions[0].id);
      syncSessionState(session);
    }
  }

  function syncSessionState(session: AdminIngestionSessionDetail) {
    setActiveSession(session);
    setSessionEditorTitle(session.title);
    setSessionEditorModel(session.model);
    setSessionEditorPrompt(session.prompt);
    setSelectedChapterIndex(
      Math.min(session.currentChapterIndex, Math.max(session.chapters.length - 1, 0)),
    );
    setEditedRawResponse(
      session.chapters[
        Math.min(session.currentChapterIndex, Math.max(session.chapters.length - 1, 0))
      ]?.rawResponse ?? "",
    );
  }

  async function handleSaveDefaults() {
    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      await api.updateAdminSettings({
        [APP_SETTING_KEYS.OPENROUTER_API_KEY]: defaultApiKey,
        [APP_SETTING_KEYS.ADMIN_INGESTION_MODEL]: defaultModel,
        [APP_SETTING_KEYS.ADMIN_INGESTION_PROMPT]: defaultPrompt,
      });
      await refreshAdminBootstrap(activeSession?.id);
      setNotice("Saved admin defaults.");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Failed to save defaults.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCreateSession() {
    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const session = await api.createAdminIngestionSession({
        title: newSessionTitle,
        sourceMode,
        sourceBookSlug:
          sourceMode === "existing_story" ? selectedSourceBookSlug : undefined,
        model: defaultModel,
        prompt: defaultPrompt,
        chapters: sourceMode === "paste" ? sourceSplitPreview : undefined,
      });

      syncSessionState(session);
      await refreshAdminBootstrap(session.id);
      setNotice("Created a new ingestion session.");
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Failed to create the session.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleLoadSession(sessionId: string) {
    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const session = await api.getAdminIngestionSession(sessionId);
      syncSessionState(session);
      setNotice(`Loaded session '${session.title}'.`);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load session.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function persistSessionEditor() {
    if (!activeSession) {
      return null;
    }

    const updated = await api.updateAdminIngestionSession(activeSession.id, {
      title: sessionEditorTitle,
      model: sessionEditorModel,
      prompt: sessionEditorPrompt,
      currentChapterIndex: selectedChapterIndex,
    });
    syncSessionState(updated);
    return updated;
  }

  async function handleSaveSessionConfig() {
    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const updated = await persistSessionEditor();
      if (updated) {
        await refreshAdminBootstrap(updated.id);
        setNotice("Saved session model and prompt.");
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save session config.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleGenerateCurrentChapter() {
    if (!activeSession || !currentSessionChapter) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const updatedSession = await persistSessionEditor();
      const sessionId = updatedSession?.id ?? activeSession.id;
      const result = await api.generateAdminIngestionChapter(
        sessionId,
        currentSessionChapter.position,
      );
      setActiveSession((current) =>
        current
          ? {
              ...current,
              chapters: current.chapters.map((chapter) =>
                chapter.id === result.chapter.id ? result.chapter : chapter,
              ),
            }
          : current,
      );
      setEditedRawResponse(result.chapter.rawResponse ?? "");
      await refreshAdminBootstrap(sessionId);
      setNotice(`Generated chapter '${currentSessionChapter.title}'.`);
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Failed to generate the current chapter.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSaveCurrentChapter() {
    if (!activeSession || !currentSessionChapter) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await api.saveAdminIngestionChapter(
        activeSession.id,
        currentSessionChapter.position,
        editedRawResponse,
      );

      if (result.session) {
        syncSessionState(result.session);
        setSelectedChapterIndex(
          Math.min(
            currentSessionChapter.position + 1,
            Math.max(result.session.chapters.length - 1, 0),
          ),
        );
      } else {
        setActiveSession((current) =>
          current
            ? {
                ...current,
                chapters: current.chapters.map((chapter) =>
                  chapter.id === result.chapter.id ? result.chapter : chapter,
                ),
              }
            : current,
        );
      }

      await refreshAdminBootstrap(activeSession.id);
      setNotice(`Saved chapter '${currentSessionChapter.title}'.`);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save the current chapter.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-8 px-6 py-8 lg:px-10">
        <section className="grid gap-6 rounded-[32px] border border-border/70 bg-white/85 p-8 shadow-panel backdrop-blur lg:grid-cols-[1.3fr_0.9fr]">
          <div className="space-y-5">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">
              Phase 2 + 3 workbench
            </p>
            <div className="space-y-4">
              <h1 className="font-display text-5xl leading-tight text-ink sm:text-6xl">
                Build translation chapter loops with review before commit.
              </h1>
              <p className="max-w-3xl text-lg leading-8 text-ink/75">
                This admin workbench lets you split source material into chapters,
                generate chunked bilingual JSON one chapter at a time, inspect the raw
                model response, edit it, save it, and continue through the book.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <ViewButton
                active={viewMode === "admin"}
                label="Admin Translation Lab"
                onClick={() => setViewMode("admin")}
              />
              <ViewButton
                active={viewMode === "reader"}
                label="Reader Preview"
                onClick={() => setViewMode("reader")}
              />
            </div>
          </div>

          <div className="grid gap-4 rounded-[28px] bg-ink p-6 text-paper">
            <Metric label="Environment" value={readerState.environment} />
            <Metric
              label="Admin sessions"
              value={String(adminBootstrap?.sessions.length ?? 0)}
            />
            <Metric
              label="Books available"
              value={String(adminBootstrap?.books.length ?? 0)}
            />
            <Metric
              label="Active chapter"
              value={currentSessionChapter?.title ?? "None selected"}
            />
          </div>
        </section>

        {isLoading ? <Panel title="Loading">Bootstrapping the workbench.</Panel> : null}
        {error ? <Panel title="Error">{error}</Panel> : null}
        {notice ? <Panel title="Status">{notice}</Panel> : null}

        {viewMode === "admin" ? (
          <section className="grid gap-6 xl:grid-cols-[360px_1fr]">
            <div className="grid gap-6">
              <Panel title="Defaults">
                <div className="space-y-4">
                  <InputField
                    label="OpenRouter API Key"
                    type="password"
                    value={defaultApiKey}
                    onChange={setDefaultApiKey}
                    placeholder="sk-or-v1-..."
                  />
                  <InputField
                    label="Default Model"
                    value={defaultModel}
                    onChange={setDefaultModel}
                    placeholder="openai/gpt-4o-mini"
                  />
                  <TextareaField
                    label="Default Prompt"
                    value={defaultPrompt}
                    onChange={setDefaultPrompt}
                    rows={10}
                    placeholder="System prompt for chunking + translation."
                  />
                  <ActionButton
                    label={isBusy ? "Saving..." : "Save Defaults"}
                    onClick={handleSaveDefaults}
                    disabled={isBusy}
                  />
                </div>
              </Panel>

              <Panel title="New Session">
                <div className="space-y-4">
                  <InputField
                    label="Session Title"
                    value={newSessionTitle}
                    onChange={setNewSessionTitle}
                    placeholder="Verse / Modern Meaning Draft"
                  />
                  <SegmentedControl
                    label="Source Mode"
                    value={sourceMode}
                    options={[
                      { value: "paste", label: "Paste source text" },
                      { value: "existing_story", label: "Use existing story" },
                    ]}
                    onChange={(value) => setSourceMode(value as SourceMode)}
                  />

                  {sourceMode === "existing_story" ? (
                    <SelectField
                      label="Existing Story"
                      value={selectedSourceBookSlug}
                      onChange={setSelectedSourceBookSlug}
                      options={(adminBootstrap?.books ?? []).map((book) => ({
                        value: book.slug,
                        label: `${book.title} (${book.status})`,
                      }))}
                    />
                  ) : (
                    <>
                      <SegmentedControl
                        label="Chapter Split"
                        value={splitMode}
                        options={[
                          { value: "heading", label: "Heading regex" },
                          { value: "delimiter", label: "Delimiter" },
                          { value: "single", label: "Single chapter" },
                        ]}
                        onChange={(value) => setSplitMode(value as ChapterSplitMode)}
                      />
                      {splitMode === "heading" ? (
                        <InputField
                          label="Heading Regex"
                          value={headingPattern}
                          onChange={setHeadingPattern}
                          placeholder="^(book|chapter|canto|scroll)\\b.*$"
                        />
                      ) : null}
                      {splitMode === "delimiter" ? (
                        <InputField
                          label="Delimiter"
                          value={delimiter}
                          onChange={setDelimiter}
                          placeholder="\n\n\n"
                        />
                      ) : null}
                      <TextareaField
                        label="Source Text"
                        value={rawSourceText}
                        onChange={setRawSourceText}
                        rows={14}
                        placeholder="Paste the original text here."
                      />
                      <div className="rounded-2xl border border-border/70 bg-paper/80 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                          Split Preview
                        </p>
                        <div className="mt-4 space-y-3">
                          {sourceSplitPreview.length > 0 ? (
                            sourceSplitPreview.map((chapter) => (
                              <div
                                key={chapter.slug + chapter.position}
                                className="rounded-2xl border border-border/60 bg-white/70 p-3"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <p className="font-semibold text-ink">{chapter.title}</p>
                                  <span className="text-xs uppercase tracking-[0.18em] text-accent/80">
                                    {chapter.sourceText.length} chars
                                  </span>
                                </div>
                                <p className="mt-2 line-clamp-4 text-sm leading-6 text-ink/70">
                                  {chapter.sourceText}
                                </p>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm leading-6 text-ink/60">
                              No chapters detected yet.
                            </p>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  <ActionButton
                    label={isBusy ? "Working..." : "Create Session"}
                    onClick={handleCreateSession}
                    disabled={
                      isBusy ||
                      !newSessionTitle.trim() ||
                      !defaultModel.trim() ||
                      !defaultPrompt.trim() ||
                      (sourceMode === "paste" && sourceSplitPreview.length === 0) ||
                      (sourceMode === "existing_story" && !selectedSourceBookSlug)
                    }
                  />
                </div>
              </Panel>

              <Panel title="Recent Sessions">
                <div className="space-y-3">
                  {(adminBootstrap?.sessions ?? []).map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                        activeSession?.id === session.id
                          ? "border-accent bg-accent/10"
                          : "border-border/70 bg-paper/80 hover:border-accent/50"
                      }`}
                      onClick={() => void handleLoadSession(session.id)}
                    >
                      <p className="font-semibold text-ink">{session.title}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-accent">
                        {session.sourceMode.replace("_", " ")} · {session.chapterCount} chapters
                      </p>
                      <p className="mt-2 text-sm text-ink/65">{session.model}</p>
                    </button>
                  ))}
                  {adminBootstrap?.sessions.length === 0 ? (
                    <p className="text-sm leading-6 text-ink/60">
                      No sessions yet.
                    </p>
                  ) : null}
                </div>
              </Panel>
            </div>

            <div className="grid gap-6">
              <Panel title="Session Workspace">
                {activeSession ? (
                  <div className="space-y-6">
                    <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
                      <div className="grid gap-4">
                        <InputField
                          label="Session Title"
                          value={sessionEditorTitle}
                          onChange={setSessionEditorTitle}
                          placeholder="Translation session title"
                        />
                        <InputField
                          label="Model"
                          value={sessionEditorModel}
                          onChange={setSessionEditorModel}
                          placeholder="openai/gpt-4o-mini"
                        />
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-paper/75 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                          Session Stats
                        </p>
                        <div className="mt-4 space-y-3 text-sm text-ink/70">
                          <p>{activeSession.chapterCount} chapters</p>
                          <p>Current index {selectedChapterIndex + 1}</p>
                          <p>Source mode {activeSession.sourceMode}</p>
                        </div>
                      </div>
                    </div>

                    <TextareaField
                      label="Session Prompt"
                      value={sessionEditorPrompt}
                      onChange={setSessionEditorPrompt}
                      rows={10}
                      placeholder="Edit the prompt used for chunking + translation."
                    />

                    <div className="flex flex-wrap gap-3">
                      <ActionButton
                        label={isBusy ? "Saving..." : "Save Session Config"}
                        onClick={handleSaveSessionConfig}
                        disabled={isBusy}
                      />
                      <ActionButton
                        label={isBusy ? "Generating..." : "Generate Current Chapter"}
                        onClick={handleGenerateCurrentChapter}
                        disabled={isBusy || !currentSessionChapter}
                        tone="accent"
                      />
                      <ActionButton
                        label={isBusy ? "Saving..." : "Save Review And Advance"}
                        onClick={handleSaveCurrentChapter}
                        disabled={isBusy || !currentSessionChapter || !editedRawResponse.trim()}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-base leading-7 text-ink/70">
                    Create or load a session to start the chapter-by-chapter workflow.
                  </p>
                )}
              </Panel>

              <section className="grid gap-6 lg:grid-cols-[280px_1fr]">
                <Panel title="Chapter Queue">
                  <div className="space-y-3">
                    {activeSession?.chapters.map((chapter, index) => (
                      <button
                        key={chapter.id}
                        type="button"
                        onClick={() => setSelectedChapterIndex(index)}
                        className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                          selectedChapterIndex === index
                            ? "border-accent bg-accent/10"
                            : "border-border/70 bg-paper/75 hover:border-accent/40"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-ink">{chapter.title}</p>
                            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-accent">
                              {chapter.slug}
                            </p>
                          </div>
                          <StatusPill status={chapter.status} />
                        </div>
                        {chapter.errorMessage ? (
                          <p className="mt-2 text-sm leading-6 text-red-700/80">
                            {chapter.errorMessage}
                          </p>
                        ) : null}
                      </button>
                    ))}
                    {activeSession?.chapters.length === 0 ? (
                      <p className="text-sm leading-6 text-ink/60">
                        No chapters in this session.
                      </p>
                    ) : null}
                  </div>
                </Panel>

                <Panel title="Current Chapter">
                  {currentSessionChapter ? (
                    <div className="space-y-6">
                      <div className="grid gap-6 xl:grid-cols-2">
                        <div className="rounded-2xl border border-border/70 bg-paper/75 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                            Source Chapter
                          </p>
                          <h3 className="mt-3 font-display text-3xl text-ink">
                            {currentSessionChapter.title}
                          </h3>
                          <p className="mt-4 whitespace-pre-wrap text-base leading-7 text-ink/80">
                            {currentSessionChapter.sourceText}
                          </p>
                        </div>

                        <div className="rounded-2xl border border-border/70 bg-white/80 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                            Raw AI Response
                          </p>
                          <textarea
                            className="mt-4 min-h-[360px] w-full rounded-2xl border border-border/70 bg-paper/70 px-4 py-3 font-mono text-sm leading-6 text-ink outline-none transition focus:border-accent"
                            value={editedRawResponse}
                            onChange={(event) => setEditedRawResponse(event.target.value)}
                            placeholder="Generate the chapter to inspect and edit JSON here."
                          />
                        </div>
                      </div>

                      <div className="grid gap-6 xl:grid-cols-2">
                        <DocumentPreview
                          title="Normalized Original Chunks"
                          chunks={currentSessionChapter.originalDocument?.chunks ?? []}
                          emptyMessage="No normalized original chunks yet. Generate or save a valid response first."
                        />
                        <TranslationPreview
                          title="Normalized Translation Chunks"
                          chunks={
                            currentSessionChapter.translationDocument?.chunks ?? []
                          }
                          emptyMessage="No normalized translation chunks yet."
                        />
                      </div>

                      {currentSessionChapter.notes ? (
                        <div className="rounded-2xl border border-border/70 bg-paper/75 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                            Model Notes
                          </p>
                          <p className="mt-3 text-sm leading-7 text-ink/80">
                            {currentSessionChapter.notes}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-base leading-7 text-ink/70">
                      Select a chapter to inspect its source text and AI response.
                    </p>
                  )}
                </Panel>
              </section>
            </div>
          </section>
        ) : (
          <section className="grid gap-6 lg:grid-cols-[320px_1fr]">
            <Panel title="Library snapshot">
              <div className="space-y-4">
                {readerState.books.map((book) => (
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

            <Panel title="Reader Preview">
              <div className="grid gap-2">
                <div className="hidden border-b border-border/60 pb-3 text-xs font-semibold uppercase tracking-[0.2em] text-accent md:grid md:grid-cols-2 md:gap-8">
                  <p>Source passage</p>
                  <p>Translation passage</p>
                </div>

                <div className="divide-y divide-border/35">
                  {readerTranslationChunks.map((chunk) => {
                    const sourceChunks = chunk.sourceChunkIds
                      .map((sourceChunkId) => readerOriginalChunkMap.get(sourceChunkId))
                      .filter(isPresent);

                    return (
                      <div
                        key={chunk.id}
                        className="grid gap-4 py-4 md:grid-cols-2 md:gap-8"
                      >
                        <div>
                          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-accent md:hidden">
                            Source passage
                          </p>
                          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-accent/85">
                            {chunk.sourceChunkIds.join(" + ")}
                          </p>
                          <div className="mt-3 space-y-3">
                            {sourceChunks.map((sourceChunk) => (
                              <p
                                key={sourceChunk.id}
                                className="font-display text-2xl leading-9 text-ink"
                              >
                                <span className="mr-3 align-top font-sans text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-accent/85">
                                  {sourceChunk.id}
                                </span>
                                {sourceChunk.text}
                              </p>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-accent md:hidden">
                            Translation passage
                          </p>
                          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-accent/85">
                            {chunk.id}
                          </p>
                          <p className="mt-3 text-lg leading-8 text-ink/80">
                            {chunk.text}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Panel>
          </section>
        )}
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-paper/15 bg-paper/5 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-paper/60">{label}</p>
      <p className="mt-3 text-lg font-semibold text-paper">{value}</p>
    </div>
  );
}

function ViewButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-5 py-3 text-sm font-semibold transition ${
        active
          ? "bg-accent text-paper"
          : "border border-border/70 bg-white/70 text-ink hover:border-accent/40"
      }`}
    >
      {label}
    </button>
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

function InputField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
        {label}
      </span>
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

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
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

function TextareaField({
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
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
        {label}
      </span>
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

function SegmentedControl({
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
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
        {label}
      </span>
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

function ActionButton({
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

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "saved"
      ? "bg-emerald-100 text-emerald-800"
      : status === "generated"
        ? "bg-amber-100 text-amber-800"
        : status === "error"
          ? "bg-red-100 text-red-800"
          : "bg-stone-200 text-stone-700";

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${tone}`}>
      {status}
    </span>
  );
}

function DocumentPreview({
  title,
  chunks,
  emptyMessage,
}: {
  title: string;
  chunks: Array<{ id: string; text: string; ordinal: number }>;
  emptyMessage: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-paper/75 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
        {title}
      </p>
      <div className="mt-4 space-y-3">
        {chunks.length > 0 ? (
          chunks.map((chunk) => (
            <div key={chunk.id} className="rounded-2xl border border-border/50 bg-white/80 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent/80">
                {chunk.id} · {chunk.ordinal}
              </p>
              <p className="mt-2 text-sm leading-7 text-ink/80">{chunk.text}</p>
            </div>
          ))
        ) : (
          <p className="text-sm leading-6 text-ink/60">{emptyMessage}</p>
        )}
      </div>
    </div>
  );
}

function TranslationPreview({
  title,
  chunks,
  emptyMessage,
}: {
  title: string;
  chunks: Array<{ id: string; text: string; ordinal: number; sourceChunkIds: string[] }>;
  emptyMessage: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-paper/75 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
        {title}
      </p>
      <div className="mt-4 space-y-3">
        {chunks.length > 0 ? (
          chunks.map((chunk) => (
            <div key={chunk.id} className="rounded-2xl border border-border/50 bg-white/80 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent/80">
                {chunk.id} · {chunk.sourceChunkIds.join(" + ")}
              </p>
              <p className="mt-2 text-sm leading-7 text-ink/80">{chunk.text}</p>
            </div>
          ))
        ) : (
          <p className="text-sm leading-6 text-ink/60">{emptyMessage}</p>
        )}
      </div>
    </div>
  );
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}