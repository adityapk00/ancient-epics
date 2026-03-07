import { useEffect, useState } from "react";

import {
  APP_SETTING_KEYS,
  type AdminBookChapterDraft,
  type AdminBookSourcePayload,
  type AdminIngestionBootstrapPayload,
  type AdminIngestionSessionDetail,
  type AdminIngestionSessionSummary,
  type AdminTranslationValidationPayload,
} from "@ancient-epics/shared";

import {
  splitSourceTextIntoChapters,
  type ChapterSplitMode,
} from "./lib/chapter-splitting";
import { api } from "./lib/api";

type AdminScreen =
  | "books"
  | "create-book"
  | "translations"
  | "workspace"
  | "validate";

export default function App() {
  const [screen, setScreen] = useState<AdminScreen>("books");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [bootstrap, setBootstrap] =
    useState<AdminIngestionBootstrapPayload | null>(null);
  const [selectedBook, setSelectedBook] =
    useState<AdminBookSourcePayload | null>(null);
  const [translationDrafts, setTranslationDrafts] = useState<
    AdminIngestionSessionSummary[]
  >([]);
  const [activeSession, setActiveSession] =
    useState<AdminIngestionSessionDetail | null>(null);
  const [validation, setValidation] =
    useState<AdminTranslationValidationPayload | null>(null);
  const [selectedChapterIndex, setSelectedChapterIndex] = useState(0);
  const [editedRawResponse, setEditedRawResponse] = useState("");
  const [validationPreviewIndex, setValidationPreviewIndex] = useState(0);

  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [settingsApiKey, setSettingsApiKey] = useState("");
  const [settingsModel, setSettingsModel] = useState("openai/gpt-4o-mini");
  const [settingsPrompt, setSettingsPrompt] = useState("");

  const [bookTitle, setBookTitle] = useState("");
  const [bookSlug, setBookSlug] = useState("");
  const [bookAuthor, setBookAuthor] = useState("");
  const [bookLanguage, setBookLanguage] = useState("");
  const [bookDescription, setBookDescription] = useState("");
  const [bookRawText, setBookRawText] = useState("");
  const [splitMode, setSplitMode] = useState<ChapterSplitMode>("heading");
  const [headingPattern, setHeadingPattern] = useState(
    "^(book|chapter|canto|scroll)\\b.*$",
  );
  const [delimiter, setDelimiter] = useState("\n\n\n");

  const [translationTitle, setTranslationTitle] = useState("");
  const [translationSlug, setTranslationSlug] = useState("");
  const [translationDescription, setTranslationDescription] = useState("");
  const [translationModel, setTranslationModel] =
    useState("openai/gpt-4o-mini");
  const [translationPrompt, setTranslationPrompt] = useState("");
  const [contextBeforeChapterCount, setContextBeforeChapterCount] =
    useState("1");
  const [contextAfterChapterCount, setContextAfterChapterCount] = useState("1");

  useEffect(() => {
    async function load() {
      try {
        const payload = await api.getAdminIngestionBootstrap();
        setBootstrap(payload);
        setSettingsApiKey(
          payload.settings[APP_SETTING_KEYS.OPENROUTER_API_KEY] ?? "",
        );
        const model =
          payload.settings[APP_SETTING_KEYS.ADMIN_INGESTION_MODEL] ??
          payload.settings[APP_SETTING_KEYS.DEFAULT_TRANSLATION_MODEL] ??
          "openai/gpt-4o-mini";
        const prompt =
          payload.settings[APP_SETTING_KEYS.ADMIN_INGESTION_PROMPT] ?? "";
        setSettingsModel(model);
        setSettingsPrompt(prompt);
        setTranslationModel(model);
        setTranslationPrompt(prompt);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load admin data.",
        );
      } finally {
        setIsLoading(false);
      }
    }

    void load();
  }, []);

  useEffect(() => {
    const chapter = activeSession?.chapters[selectedChapterIndex];
    setEditedRawResponse(chapter?.rawResponse ?? "");
  }, [activeSession, selectedChapterIndex]);

  const chapterPreview = splitSourceTextIntoChapters({
    rawText: bookRawText,
    splitMode,
    headingPattern,
    delimiter,
  });

  const currentWorkspaceChapter =
    activeSession?.chapters[selectedChapterIndex] ?? null;
  const validationPreviewChapter =
    validation?.session.chapters[validationPreviewIndex] ?? null;

  async function refreshBootstrap() {
    const payload = await api.getAdminIngestionBootstrap();
    setBootstrap(payload);
  }

  function resetBookForm() {
    setBookTitle("");
    setBookSlug("");
    setBookAuthor("");
    setBookLanguage("");
    setBookDescription("");
    setBookRawText("");
    setSplitMode("heading");
    setHeadingPattern("^(book|chapter|canto|scroll)\\b.*$");
    setDelimiter("\n\n\n");
  }

  function resetTranslationForm() {
    setTranslationTitle("");
    setTranslationSlug("");
    setTranslationDescription("");
    setTranslationModel(settingsModel);
    setTranslationPrompt(settingsPrompt);
    setContextBeforeChapterCount("1");
    setContextAfterChapterCount("1");
  }

  async function openBook(bookSlugValue: string) {
    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const [book, drafts] = await Promise.all([
        api.getAdminBookSource(bookSlugValue),
        api.listAdminTranslationDrafts(bookSlugValue),
      ]);
      setSelectedBook(book);
      setTranslationDrafts(drafts.sessions);
      setActiveSession(null);
      setValidation(null);
      resetTranslationForm();
      setScreen("translations");
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load book.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function saveSettings() {
    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      await api.updateAdminSettings({
        [APP_SETTING_KEYS.OPENROUTER_API_KEY]: settingsApiKey,
        [APP_SETTING_KEYS.ADMIN_INGESTION_MODEL]: settingsModel,
        [APP_SETTING_KEYS.ADMIN_INGESTION_PROMPT]: settingsPrompt,
      });
      await refreshBootstrap();
      setTranslationModel(settingsModel);
      setTranslationPrompt(settingsPrompt);
      setSettingsOpen(false);
      setNotice("Saved settings.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save settings.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function createBook() {
    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const created = await api.createAdminBook({
        title: bookTitle,
        slug: bookSlug || undefined,
        author: bookAuthor || undefined,
        originalLanguage: bookLanguage || undefined,
        description: bookDescription || undefined,
        chapters: chapterPreview as AdminBookChapterDraft[],
      });
      await refreshBootstrap();
      setSelectedBook(created);
      setTranslationDrafts([]);
      resetBookForm();
      resetTranslationForm();
      setScreen("translations");
      setNotice(`Created draft book '${created.book.title}'.`);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Failed to create book.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function createTranslationDraft() {
    if (!selectedBook) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const session = await api.createAdminTranslationDraft(
        selectedBook.book.slug,
        {
          title: translationTitle,
          slug: translationSlug || undefined,
          description: translationDescription || undefined,
          model: translationModel,
          prompt: translationPrompt,
          contextBeforeChapterCount: Number(contextBeforeChapterCount || 0),
          contextAfterChapterCount: Number(contextAfterChapterCount || 0),
        },
      );
      const drafts = await api.listAdminTranslationDrafts(
        selectedBook.book.slug,
      );
      setTranslationDrafts(drafts.sessions);
      setActiveSession(session);
      setSelectedChapterIndex(
        Math.min(
          session.currentChapterIndex,
          Math.max(session.chapters.length - 1, 0),
        ),
      );
      setScreen("workspace");
      setNotice(`Created translation draft '${session.title}'.`);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Failed to create translation draft.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function openTranslationDraft(sessionId: string) {
    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const session = await api.getAdminIngestionSession(sessionId);
      setActiveSession(session);
      setTranslationTitle(session.title);
      setTranslationSlug("");
      setTranslationModel(session.model);
      setTranslationPrompt(session.prompt);
      setContextBeforeChapterCount(String(session.contextBeforeChapterCount));
      setContextAfterChapterCount(String(session.contextAfterChapterCount));
      setSelectedChapterIndex(
        Math.min(
          session.currentChapterIndex,
          Math.max(session.chapters.length - 1, 0),
        ),
      );
      setValidation(null);
      setScreen("workspace");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load translation draft.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function saveWorkspaceConfig() {
    if (!activeSession) {
      return;
    }

    const updated = await api.updateAdminIngestionSession(activeSession.id, {
      title: translationTitle || activeSession.title,
      model: translationModel,
      prompt: translationPrompt,
      contextBeforeChapterCount: Number(contextBeforeChapterCount || 0),
      contextAfterChapterCount: Number(contextAfterChapterCount || 0),
      currentChapterIndex: selectedChapterIndex,
    });
    setActiveSession(updated);
    return updated;
  }

  async function generateCurrentChapter() {
    if (!activeSession || !currentWorkspaceChapter) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const updatedSession = await saveWorkspaceConfig();
      const sessionId = updatedSession?.id ?? activeSession.id;
      const result = await api.generateAdminIngestionChapter(
        sessionId,
        currentWorkspaceChapter.position,
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
      setNotice(`Generated '${currentWorkspaceChapter.title}'.`);
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Failed to generate chapter.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function saveCurrentChapter() {
    if (!activeSession || !currentWorkspaceChapter) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await api.saveAdminIngestionChapter(
        activeSession.id,
        currentWorkspaceChapter.position,
        editedRawResponse,
      );

      if (result.session) {
        setActiveSession(result.session);
        setSelectedChapterIndex(
          Math.min(
            currentWorkspaceChapter.position + 1,
            Math.max(result.session.chapters.length - 1, 0),
          ),
        );
      }

      if (selectedBook) {
        const drafts = await api.listAdminTranslationDrafts(
          selectedBook.book.slug,
        );
        setTranslationDrafts(drafts.sessions);
      }

      setNotice(`Saved '${currentWorkspaceChapter.title}'.`);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save chapter.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function validateCurrentDraft() {
    if (!activeSession) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const updatedSession = await saveWorkspaceConfig();
      const payload = await api.validateAdminTranslationDraft(
        updatedSession?.id ?? activeSession.id,
      );
      setValidation(payload);
      setValidationPreviewIndex(0);
      setScreen("validate");
      setNotice(
        payload.isValid ? "Validation passed." : "Validation found issues.",
      );
    } catch (validateError) {
      setError(
        validateError instanceof Error
          ? validateError.message
          : "Failed to validate translation draft.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-8 px-6 py-8 lg:px-10">
        <header className="flex flex-wrap items-start justify-between gap-4 rounded-[32px] border border-border/70 bg-white/85 p-8 shadow-panel backdrop-blur">
          <div className="space-y-3">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">
              Admin Console
            </p>
            <h1 className="font-display text-5xl leading-tight text-ink sm:text-6xl">
              Manage books, translation drafts, and validation in one flow.
            </h1>
            <p className="max-w-3xl text-lg leading-8 text-ink/75">
              Start from the library, create a book, open its translation
              drafts, run the chapter-by-chapter AI loop, then validate the
              whole draft before you publish or export it.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {selectedBook ? (
              <button
                type="button"
                onClick={() => setScreen("books")}
                className="rounded-full border border-border/70 bg-paper/80 px-5 py-3 text-sm font-semibold text-ink transition hover:border-accent/50"
              >
                All Books
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-paper transition hover:bg-ink/90"
            >
              Settings
            </button>
          </div>
        </header>

        {isLoading ? <Panel title="Loading">Loading admin data.</Panel> : null}
        {error ? <Panel title="Error">{error}</Panel> : null}
        {notice ? <Panel title="Status">{notice}</Panel> : null}

        {screen === "books" ? (
          <section className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <Panel title="Books / Stories">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {(bootstrap?.books ?? []).map((book) => (
                  <button
                    key={book.id}
                    type="button"
                    onClick={() => void openBook(book.slug)}
                    className="rounded-[24px] border border-border/70 bg-paper/80 p-5 text-left transition hover:border-accent/50 hover:bg-white"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                      {book.status}
                    </p>
                    <h2 className="mt-3 font-display text-3xl text-ink">
                      {book.title}
                    </h2>
                    <p className="mt-2 text-sm text-ink/65">{book.author}</p>
                    <p className="mt-4 text-sm leading-7 text-ink/75">
                      {book.description || "No description yet."}
                    </p>
                  </button>
                ))}
                {(bootstrap?.books?.length ?? 0) === 0 ? (
                  <p className="text-base leading-7 text-ink/70">
                    No books yet.
                  </p>
                ) : null}
              </div>
            </Panel>

            <Panel title="Create New">
              <p className="text-base leading-7 text-ink/70">
                Create a new source text, paste the full work, then split it
                into chapters before moving into translation drafts.
              </p>
              <div className="mt-6">
                <ActionButton
                  label="Create New Book"
                  onClick={() => setScreen("create-book")}
                  tone="accent"
                />
              </div>
            </Panel>
          </section>
        ) : null}

        {screen === "create-book" ? (
          <section className="grid gap-6 xl:grid-cols-[380px_1fr]">
            <Panel title="Book Details">
              <div className="space-y-4">
                <InputField
                  label="Title"
                  value={bookTitle}
                  onChange={setBookTitle}
                />
                <InputField
                  label="Slug"
                  value={bookSlug}
                  onChange={setBookSlug}
                />
                <InputField
                  label="Author"
                  value={bookAuthor}
                  onChange={setBookAuthor}
                />
                <InputField
                  label="Original Language"
                  value={bookLanguage}
                  onChange={setBookLanguage}
                />
                <TextareaField
                  label="Description"
                  value={bookDescription}
                  onChange={setBookDescription}
                  rows={5}
                />
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
                  />
                ) : null}
                {splitMode === "delimiter" ? (
                  <InputField
                    label="Delimiter"
                    value={delimiter}
                    onChange={setDelimiter}
                  />
                ) : null}
                <ActionButton
                  label="Back To Books"
                  onClick={() => setScreen("books")}
                />
              </div>
            </Panel>

            <div className="grid gap-6">
              <Panel title="Paste Source Text">
                <TextareaField
                  label="Full Text"
                  value={bookRawText}
                  onChange={setBookRawText}
                  rows={18}
                  placeholder="Paste the full source text here."
                />
              </Panel>

              <Panel title="Chapter Preview">
                <div className="space-y-4">
                  {chapterPreview.map((chapter) => (
                    <div
                      key={chapter.slug + chapter.position}
                      className="rounded-2xl border border-border/60 bg-paper/80 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-ink">
                            {chapter.title}
                          </p>
                          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-accent">
                            {chapter.slug}
                          </p>
                        </div>
                        <span className="text-xs uppercase tracking-[0.18em] text-accent/80">
                          {chapter.sourceText.length} chars
                        </span>
                      </div>
                      <p className="mt-3 line-clamp-5 text-sm leading-7 text-ink/75">
                        {chapter.sourceText}
                      </p>
                    </div>
                  ))}
                  {chapterPreview.length === 0 ? (
                    <p className="text-base leading-7 text-ink/65">
                      Paste source text and choose a chapter split strategy to
                      preview chapters.
                    </p>
                  ) : null}
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <ActionButton
                    label={isBusy ? "Saving..." : "Create Book"}
                    onClick={createBook}
                    tone="accent"
                    disabled={
                      isBusy || !bookTitle.trim() || chapterPreview.length === 0
                    }
                  />
                </div>
              </Panel>
            </div>
          </section>
        ) : null}

        {screen === "translations" && selectedBook ? (
          <section className="grid gap-6 xl:grid-cols-[360px_1fr]">
            <Panel title="Current Book">
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                  {selectedBook.book.status}
                </p>
                <h2 className="font-display text-4xl text-ink">
                  {selectedBook.book.title}
                </h2>
                <p className="text-sm text-ink/65">
                  {selectedBook.book.author}
                </p>
                <p className="text-sm leading-7 text-ink/75">
                  {selectedBook.book.description || "No description yet."}
                </p>
                <div className="rounded-2xl border border-border/70 bg-paper/75 p-4 text-sm leading-7 text-ink/70">
                  {selectedBook.chapters.length} chapters saved to D1/R2.
                </div>
                <ActionButton
                  label="Back To Books"
                  onClick={() => setScreen("books")}
                />
              </div>
            </Panel>

            <div className="grid gap-6">
              <Panel title="Translations">
                <div className="grid gap-4 md:grid-cols-2">
                  {translationDrafts.map((draft) => (
                    <button
                      key={draft.id}
                      type="button"
                      onClick={() => void openTranslationDraft(draft.id)}
                      className="rounded-[24px] border border-border/70 bg-paper/80 p-5 text-left transition hover:border-accent/50 hover:bg-white"
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                        {draft.chapterCount} chapters
                      </p>
                      <h3 className="mt-3 font-display text-3xl text-ink">
                        {draft.title}
                      </h3>
                      <p className="mt-2 text-sm leading-7 text-ink/70">
                        {draft.model}
                      </p>
                      <p className="mt-3 text-sm leading-7 text-ink/60">
                        Context: {draft.contextBeforeChapterCount} before,{" "}
                        {draft.contextAfterChapterCount} after
                      </p>
                    </button>
                  ))}
                  {translationDrafts.length === 0 ? (
                    <p className="text-base leading-7 text-ink/65">
                      No translation drafts yet.
                    </p>
                  ) : null}
                </div>
              </Panel>

              <Panel title="Create Translation Draft">
                <div className="grid gap-4 lg:grid-cols-2">
                  <InputField
                    label="Translation Name"
                    value={translationTitle}
                    onChange={setTranslationTitle}
                  />
                  <InputField
                    label="Slug"
                    value={translationSlug}
                    onChange={setTranslationSlug}
                  />
                  <InputField
                    label="Model"
                    value={translationModel}
                    onChange={setTranslationModel}
                  />
                  <InputField
                    label="Description"
                    value={translationDescription}
                    onChange={setTranslationDescription}
                  />
                  <InputField
                    label="Context Before Chapters"
                    value={contextBeforeChapterCount}
                    onChange={setContextBeforeChapterCount}
                  />
                  <InputField
                    label="Context After Chapters"
                    value={contextAfterChapterCount}
                    onChange={setContextAfterChapterCount}
                  />
                </div>
                <div className="mt-4">
                  <TextareaField
                    label="Prompt"
                    value={translationPrompt}
                    onChange={setTranslationPrompt}
                    rows={10}
                  />
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <ActionButton
                    label={isBusy ? "Creating..." : "Create Translation Draft"}
                    onClick={createTranslationDraft}
                    tone="accent"
                    disabled={
                      isBusy ||
                      !translationTitle.trim() ||
                      !translationModel.trim() ||
                      !translationPrompt.trim()
                    }
                  />
                </div>
              </Panel>
            </div>
          </section>
        ) : null}

        {screen === "workspace" && activeSession ? (
          <section className="grid gap-6 xl:grid-cols-[300px_1fr]">
            <Panel title="Chapter Queue">
              <div className="space-y-3">
                {activeSession.chapters.map((chapter, index) => (
                  <button
                    key={chapter.id}
                    type="button"
                    onClick={() => setSelectedChapterIndex(index)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      selectedChapterIndex === index
                        ? "border-accent bg-accent/10"
                        : "border-border/70 bg-paper/80 hover:border-accent/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink">
                          {chapter.title}
                        </p>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-accent">
                          {chapter.slug}
                        </p>
                      </div>
                      <StatusPill status={chapter.status} />
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <ActionButton
                  label="Back To Translations"
                  onClick={() => setScreen("translations")}
                />
                <ActionButton
                  label="Validate Draft"
                  onClick={validateCurrentDraft}
                  tone="accent"
                />
              </div>
            </Panel>

            <div className="grid gap-6">
              <Panel title="Translation Workspace">
                <div className="grid gap-4 lg:grid-cols-2">
                  <InputField
                    label="Translation Name"
                    value={translationTitle}
                    onChange={setTranslationTitle}
                  />
                  <InputField
                    label="Model"
                    value={translationModel}
                    onChange={setTranslationModel}
                  />
                  <InputField
                    label="Context Before Chapters"
                    value={contextBeforeChapterCount}
                    onChange={setContextBeforeChapterCount}
                  />
                  <InputField
                    label="Context After Chapters"
                    value={contextAfterChapterCount}
                    onChange={setContextAfterChapterCount}
                  />
                </div>
                <div className="mt-4">
                  <TextareaField
                    label="Prompt"
                    value={translationPrompt}
                    onChange={setTranslationPrompt}
                    rows={10}
                  />
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <ActionButton
                    label={isBusy ? "Saving..." : "Save Draft Settings"}
                    onClick={() => void saveWorkspaceConfig()}
                    disabled={isBusy}
                  />
                  <ActionButton
                    label={
                      isBusy ? "Generating..." : "Generate Current Chapter"
                    }
                    onClick={generateCurrentChapter}
                    tone="accent"
                    disabled={isBusy || !currentWorkspaceChapter}
                  />
                  <ActionButton
                    label={isBusy ? "Saving..." : "Save Review And Continue"}
                    onClick={saveCurrentChapter}
                    disabled={isBusy || !editedRawResponse.trim()}
                  />
                </div>
              </Panel>

              {currentWorkspaceChapter ? (
                <>
                  <Panel title={`Source: ${currentWorkspaceChapter.title}`}>
                    <p className="whitespace-pre-wrap text-base leading-7 text-ink/80">
                      {currentWorkspaceChapter.sourceText}
                    </p>
                  </Panel>

                  <Panel title="Review AI Response">
                    <textarea
                      className="min-h-[360px] w-full rounded-2xl border border-border/70 bg-paper/70 px-4 py-3 font-mono text-sm leading-6 text-ink outline-none transition focus:border-accent"
                      value={editedRawResponse}
                      onChange={(event) =>
                        setEditedRawResponse(event.target.value)
                      }
                      placeholder="Generate the chapter, then review and edit the JSON response here."
                    />
                  </Panel>

                  <section className="grid gap-6 xl:grid-cols-2">
                    <DocumentPreview
                      title="Original Chunks"
                      chunks={
                        currentWorkspaceChapter.originalDocument?.chunks ?? []
                      }
                      emptyMessage="No normalized original chunks yet."
                    />
                    <TranslationPreview
                      title="Translation Chunks"
                      chunks={
                        currentWorkspaceChapter.translationDocument?.chunks ??
                        []
                      }
                      emptyMessage="No normalized translation chunks yet."
                    />
                  </section>
                </>
              ) : null}
            </div>
          </section>
        ) : null}

        {screen === "validate" && validation ? (
          <section className="grid gap-6 xl:grid-cols-[320px_1fr]">
            <Panel title="Validation Summary">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">
                {validation.isValid ? "Ready for next step" : "Issues found"}
              </p>
              <div className="mt-4 space-y-3">
                {validation.issues.length > 0 ? (
                  validation.issues.map((issue, index) => (
                    <div
                      key={`${issue.level}-${index}`}
                      className={`rounded-2xl border p-3 text-sm leading-6 ${
                        issue.level === "error"
                          ? "border-red-200 bg-red-50 text-red-800"
                          : "border-amber-200 bg-amber-50 text-amber-900"
                      }`}
                    >
                      {issue.message}
                    </div>
                  ))
                ) : (
                  <p className="text-base leading-7 text-ink/70">
                    No validation issues found.
                  </p>
                )}
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <ActionButton
                  label="Back To Workspace"
                  onClick={() => setScreen("workspace")}
                />
              </div>
            </Panel>

            <div className="grid gap-6">
              <Panel title="Chapter Checks">
                <div className="grid gap-3 md:grid-cols-2">
                  {validation.chapters.map((chapter, index) => (
                    <button
                      key={chapter.slug + chapter.position}
                      type="button"
                      onClick={() => setValidationPreviewIndex(index)}
                      className={`rounded-2xl border px-4 py-3 text-left transition ${
                        validationPreviewIndex === index
                          ? "border-accent bg-accent/10"
                          : "border-border/70 bg-paper/80 hover:border-accent/50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-ink">
                            {chapter.title}
                          </p>
                          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-accent">
                            {chapter.slug}
                          </p>
                        </div>
                        <StatusPill status={chapter.status} />
                      </div>
                      {chapter.issues.length > 0 ? (
                        <p className="mt-2 text-sm leading-6 text-ink/65">
                          {chapter.issues.length} issue(s)
                        </p>
                      ) : (
                        <p className="mt-2 text-sm leading-6 text-emerald-700">
                          No issues
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </Panel>

              {validationPreviewChapter ? (
                <Panel title="Side-by-Side Preview">
                  <ChapterSideBySidePreview
                    chapter={validationPreviewChapter}
                  />
                </Panel>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

      {settingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-ink/35 px-4 py-6">
          <div className="w-full max-w-xl rounded-[32px] border border-border/70 bg-white p-6 shadow-panel">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-display text-4xl text-ink">Settings</h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-full border border-border/70 px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent/50"
              >
                Close
              </button>
            </div>
            <div className="mt-6 space-y-4">
              <InputField
                label="OpenRouter API Key"
                value={settingsApiKey}
                onChange={setSettingsApiKey}
                type="password"
              />
              <InputField
                label="Default Model"
                value={settingsModel}
                onChange={setSettingsModel}
              />
              <TextareaField
                label="Default Prompt"
                value={settingsPrompt}
                onChange={setSettingsPrompt}
                rows={12}
              />
              <ActionButton
                label={isBusy ? "Saving..." : "Save Settings"}
                onClick={saveSettings}
                tone="accent"
                disabled={isBusy}
              />
            </div>
          </div>
        </div>
      ) : null}
    </main>
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
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
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
        className="rounded-2xl border border-border/70 bg-paper/70 px-4 py-3 text-base text-ink outline-none transition focus:border-accent"
      />
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
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${tone}`}
    >
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
            <div
              key={chunk.id}
              className="rounded-2xl border border-border/50 bg-white/80 p-3"
            >
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
  chunks: Array<{ id: string; text: string; sourceChunkIds: string[] }>;
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
            <div
              key={chunk.id}
              className="rounded-2xl border border-border/50 bg-white/80 p-3"
            >
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

function ChapterSideBySidePreview({
  chapter,
}: {
  chapter: NonNullable<
    AdminTranslationValidationPayload["session"]
  >["chapters"][number];
}) {
  const originalMap = new Map(
    (chapter.originalDocument?.chunks ?? []).map((chunk) => [chunk.id, chunk]),
  );

  return (
    <div className="divide-y divide-border/35">
      {(chapter.translationDocument?.chunks ?? []).map((chunk) => {
        const sourceChunks = chunk.sourceChunkIds
          .map((chunkId) => originalMap.get(chunkId))
          .filter(isPresent);

        return (
          <div
            key={chunk.id}
            className="grid gap-4 py-4 md:grid-cols-2 md:gap-8"
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                Source · {chunk.sourceChunkIds.join(" + ")}
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
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                Translation · {chunk.id}
              </p>
              <p className="mt-3 text-lg leading-8 text-ink/80">{chunk.text}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}
