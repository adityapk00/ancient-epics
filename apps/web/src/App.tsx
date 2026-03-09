import { useEffect, useMemo, useState } from "react";

import {
  APP_SETTING_KEYS,
  type AiProvider,
  type AdminBookChapterInput,
  type AdminBookSourcePayload,
  type AdminIngestionBootstrapPayload,
  type AdminIngestionChapterRecord,
  type AdminTranslationDetail,
  type AdminTranslationSummary,
  type AdminTranslationValidationPayload,
} from "@ancient-epics/shared";

import { splitSourceTextIntoChapters, type ChapterSplitMode, type SplitChapterInput } from "./lib/chapter-splitting";
import { api } from "./lib/api";

type AdminScreen = "books" | "create-book" | "translations" | "workspace" | "validate";

type ChapterEditorState = {
  chapterTitle: string;
  notes: string;
  chunks: Array<{
    originalText: string;
    translatedText: string;
    type: "prose" | "verse";
  }>;
};

type DiffSegment = {
  value: string;
  kind: "equal" | "remove" | "add";
};

type DiffLine = {
  left: DiffSegment[];
  right: DiffSegment[];
  leftLineNumber: number | null;
  rightLineNumber: number | null;
  hasChanges: boolean;
};

const DEFAULT_PROVIDER: AiProvider = "google";
const DEFAULT_MODEL = "gemini-3-flash-preview";
const DEFAULT_HEADING_PATTERN = "^(book|chapter|canto|scroll)\\b.*$";
const PROVIDER_OPTIONS = [
  { value: "google", label: "Google Gemini SDK" },
  { value: "openrouter", label: "OpenRouter" },
] as const;
const THINKING_LEVEL_OPTIONS = [
  { value: "", label: "Default" },
  { value: "none", label: "Off" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "X-High" },
] as const;

export default function App() {
  const [screen, setScreen] = useState<AdminScreen>("books");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showAdvancedTranslationSettings, setShowAdvancedTranslationSettings] = useState(false);
  const [showRawJsonEditor, setShowRawJsonEditor] = useState(false);

  const [bootstrap, setBootstrap] = useState<AdminIngestionBootstrapPayload | null>(null);
  const [selectedBook, setSelectedBook] = useState<AdminBookSourcePayload | null>(null);
  const [translations, setTranslations] = useState<AdminTranslationSummary[]>([]);
  const [activeTranslation, setActiveTranslation] = useState<AdminTranslationDetail | null>(null);
  const [validation, setValidation] = useState<AdminTranslationValidationPayload | null>(null);
  const [selectedChapterIndex, setSelectedChapterIndex] = useState(0);
  const [validationPreviewIndex, setValidationPreviewIndex] = useState(0);

  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [settingsOpenRouterApiKey, setSettingsOpenRouterApiKey] = useState("");
  const [settingsGoogleApiKey, setSettingsGoogleApiKey] = useState("");
  const [settingsProvider, setSettingsProvider] = useState<AiProvider>(DEFAULT_PROVIDER);
  const [settingsModel, setSettingsModel] = useState(DEFAULT_MODEL);
  const [settingsPrompt, setSettingsPrompt] = useState("");

  const [bookTitle, setBookTitle] = useState("");
  const [bookAuthor, setBookAuthor] = useState("");
  const [bookLanguage, setBookLanguage] = useState("");
  const [bookDescription, setBookDescription] = useState("");
  const [bookRawText, setBookRawText] = useState("");
  const [splitMode, setSplitMode] = useState<ChapterSplitMode>("heading");
  const [headingPattern, setHeadingPattern] = useState(DEFAULT_HEADING_PATTERN);
  const [delimiter, setDelimiter] = useState("\n\n\n");
  const [stagedChapters, setStagedChapters] = useState<SplitChapterInput[]>([]);

  const [translationTitle, setTranslationTitle] = useState("");
  const [translationSlug, setTranslationSlug] = useState("");
  const [translationDescription, setTranslationDescription] = useState("");
  const [translationProvider, setTranslationProvider] = useState<AiProvider>(DEFAULT_PROVIDER);
  const [translationModel, setTranslationModel] = useState(DEFAULT_MODEL);
  const [translationThinkingLevel, setTranslationThinkingLevel] = useState("");
  const [translationPrompt, setTranslationPrompt] = useState("");
  const [contextBeforeChapterCount, setContextBeforeChapterCount] = useState("1");
  const [contextAfterChapterCount, setContextAfterChapterCount] = useState("1");
  const [editedRawResponse, setEditedRawResponse] = useState("");
  const [chapterEditor, setChapterEditor] = useState<ChapterEditorState | null>(null);
  const [workspaceSourceExpanded, setWorkspaceSourceExpanded] = useState(false);

  const activeSession = activeTranslation?.currentSession ?? null;
  const currentWorkspaceChapter = activeSession?.chapters[selectedChapterIndex] ?? null;
  const validationPreviewChapter = validation?.session.chapters[validationPreviewIndex] ?? null;
  const currentValidationChapter =
    validation && currentWorkspaceChapter
      ? (validation.chapters.find((chapter) => chapter.position === currentWorkspaceChapter.position) ?? null)
      : null;
  const translationMetadataIsDirty = useMemo(() => {
    if (!activeTranslation) {
      return false;
    }

    return (
      JSON.stringify(
        buildTranslationMetadataSnapshot({
          activeTranslation,
          activeSession,
        }),
      ) !==
      JSON.stringify({
        name: translationTitle.trim(),
        slug: translationSlug.trim(),
        description: translationDescription.trim(),
        provider: translationProvider,
        model: translationModel.trim(),
        thinkingLevel: normalizeThinkingLevelValue(translationThinkingLevel),
        prompt: translationPrompt,
        contextBeforeChapterCount: Number(contextBeforeChapterCount || 0),
        contextAfterChapterCount: Number(contextAfterChapterCount || 0),
      })
    );
  }, [
    activeTranslation,
    activeSession,
    contextAfterChapterCount,
    contextBeforeChapterCount,
    translationDescription,
    translationProvider,
    translationModel,
    translationPrompt,
    translationThinkingLevel,
    translationSlug,
    translationTitle,
  ]);
  const chapterIsDirty = useMemo(() => {
    if (!currentWorkspaceChapter || !chapterEditor) {
      return false;
    }

    return (
      JSON.stringify(serializeEditorState(buildChapterEditorState(currentWorkspaceChapter))) !==
      JSON.stringify(serializeEditorState(chapterEditor))
    );
  }, [chapterEditor, currentWorkspaceChapter]);

  const chapterPreview = useMemo(
    () =>
      splitSourceTextIntoChapters({
        rawText: bookRawText,
        splitMode,
        headingPattern,
        delimiter,
      }),
    [bookRawText, delimiter, headingPattern, splitMode],
  );
  const sourceDiff = useMemo(() => {
    if (!currentWorkspaceChapter || !chapterEditor) {
      return null;
    }

    const sourceText = currentWorkspaceChapter.sourceText;
    const reconstructedText = chapterEditor.chunks.map((chunk) => chunk.originalText).join("");

    return {
      sourceText,
      reconstructedText,
      hasMismatch: normalizeChapterText(sourceText) !== normalizeChapterText(reconstructedText),
      lines: buildSideBySideDiff(sourceText, reconstructedText),
    };
  }, [chapterEditor, currentWorkspaceChapter]);

  useEffect(() => {
    async function load() {
      try {
        const payload = await api.getAdminIngestionBootstrap();
        setBootstrap(payload);
        setSettingsOpenRouterApiKey(payload.settings[APP_SETTING_KEYS.OPENROUTER_API_KEY] ?? "");
        setSettingsGoogleApiKey(payload.settings[APP_SETTING_KEYS.GOOGLE_API_KEY] ?? "");
        const provider = normalizeProviderValue(payload.settings[APP_SETTING_KEYS.ADMIN_INGESTION_PROVIDER]);
        const model =
          payload.settings[APP_SETTING_KEYS.ADMIN_INGESTION_MODEL] ??
          payload.settings[APP_SETTING_KEYS.DEFAULT_TRANSLATION_MODEL] ??
          DEFAULT_MODEL;
        const prompt = payload.settings[APP_SETTING_KEYS.ADMIN_INGESTION_PROMPT] ?? "";
        setSettingsProvider(provider);
        setSettingsModel(model);
        setSettingsPrompt(prompt);
        setTranslationProvider(provider);
        setTranslationModel(model);
        setTranslationPrompt(prompt);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load admin data.");
      } finally {
        setIsLoading(false);
      }
    }

    void load();
  }, []);

  useEffect(() => {
    const nextEditor = currentWorkspaceChapter ? buildChapterEditorState(currentWorkspaceChapter) : null;
    setChapterEditor(nextEditor);
    setEditedRawResponse(nextEditor ? JSON.stringify(serializeEditorState(nextEditor), null, 2) : "");
    setWorkspaceSourceExpanded(false);
  }, [currentWorkspaceChapter]);

  async function refreshBootstrap() {
    const payload = await api.getAdminIngestionBootstrap();
    setBootstrap(payload);
    setSettingsOpenRouterApiKey(payload.settings[APP_SETTING_KEYS.OPENROUTER_API_KEY] ?? "");
    setSettingsGoogleApiKey(payload.settings[APP_SETTING_KEYS.GOOGLE_API_KEY] ?? "");
    const provider = normalizeProviderValue(payload.settings[APP_SETTING_KEYS.ADMIN_INGESTION_PROVIDER]);
    const model =
      payload.settings[APP_SETTING_KEYS.ADMIN_INGESTION_MODEL] ??
      payload.settings[APP_SETTING_KEYS.DEFAULT_TRANSLATION_MODEL] ??
      DEFAULT_MODEL;
    const prompt = payload.settings[APP_SETTING_KEYS.ADMIN_INGESTION_PROMPT] ?? "";
    setSettingsProvider(provider);
    setSettingsModel(model);
    setSettingsPrompt(prompt);
  }

  function resetBookForm() {
    setBookTitle("");
    setBookAuthor("");
    setBookLanguage("");
    setBookDescription("");
    setBookRawText("");
    setSplitMode("heading");
    setHeadingPattern(DEFAULT_HEADING_PATTERN);
    setDelimiter("\n\n\n");
    setStagedChapters([]);
  }

  function resetTranslationForm() {
    setTranslationTitle("");
    setTranslationSlug("");
    setTranslationDescription("");
    setTranslationProvider(settingsProvider);
    setTranslationModel(settingsModel);
    setTranslationThinkingLevel("");
    setTranslationPrompt(settingsPrompt);
    setContextBeforeChapterCount("1");
    setContextAfterChapterCount("1");
    setShowAdvancedTranslationSettings(false);
  }

  async function openBook(bookSlugValue: string) {
    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const [book, translationResult] = await Promise.all([
        api.getAdminBookSource(bookSlugValue),
        api.listAdminTranslations(bookSlugValue),
      ]);
      setSelectedBook(book);
      setTranslations(translationResult.translations);
      setActiveTranslation(null);
      setValidation(null);
      resetTranslationForm();
      setScreen("translations");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load book.");
    } finally {
      setIsBusy(false);
    }
  }

  async function refreshTranslations(bookSlugValue: string) {
    const translationResult = await api.listAdminTranslations(bookSlugValue);
    setTranslations(translationResult.translations);
  }

  async function saveSettings() {
    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      await api.updateAdminSettings({
        [APP_SETTING_KEYS.OPENROUTER_API_KEY]: settingsOpenRouterApiKey,
        [APP_SETTING_KEYS.GOOGLE_API_KEY]: settingsGoogleApiKey,
        [APP_SETTING_KEYS.ADMIN_INGESTION_PROVIDER]: settingsProvider,
        [APP_SETTING_KEYS.ADMIN_INGESTION_MODEL]: settingsModel,
        [APP_SETTING_KEYS.ADMIN_INGESTION_PROMPT]: settingsPrompt,
      });
      await refreshBootstrap();
      setSettingsOpen(false);
      setNotice("Saved settings.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save settings.");
    } finally {
      setIsBusy(false);
    }
  }

  function seedStageFromPreview() {
    setStagedChapters(
      chapterPreview.map((chapter, index) => ({
        ...chapter,
        position: index,
      })),
    );
  }

  function updateStagedChapter(index: number, key: keyof SplitChapterInput, value: string | null) {
    setStagedChapters((current) =>
      current.map((chapter, chapterIndex) =>
        chapterIndex === index
          ? {
              ...chapter,
              [key]: key === "sourceChapterSlug" ? value : typeof value === "string" ? value : chapter[key],
            }
          : chapter,
      ),
    );
  }

  function moveStagedChapter(index: number, direction: -1 | 1) {
    setStagedChapters((current) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [chapter] = next.splice(index, 1);
      if (!chapter) {
        return current;
      }
      next.splice(targetIndex, 0, chapter);
      return next.map((entry, position) => ({ ...entry, position }));
    });
  }

  function deleteStagedChapter(index: number) {
    setStagedChapters((current) =>
      current.filter((_, chapterIndex) => chapterIndex !== index).map((entry, position) => ({ ...entry, position })),
    );
  }

  function splitStagedChapter(index: number) {
    setStagedChapters((current) => {
      const chapter = current[index];
      if (!chapter) {
        return current;
      }

      const parts = chapter.sourceText
        .split(/\n\s*\n/)
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (parts.length < 2) {
        return current;
      }

      const firstPart = parts[0];
      if (!firstPart) {
        return current;
      }

      const head = {
        ...chapter,
        title: `${chapter.title} I`,
        slug: `${chapter.slug}-1`,
        sourceText: firstPart,
      };
      const tail = {
        ...chapter,
        title: `${chapter.title} II`,
        slug: `${chapter.slug}-2`,
        sourceText: parts.slice(1).join("\n\n"),
      };
      const next = [...current];
      next.splice(index, 1, head, tail);
      return next.map((entry, position) => ({ ...entry, position }));
    });
  }

  function mergeStagedChapter(index: number) {
    setStagedChapters((current) => {
      if (index === 0) {
        return current;
      }
      const previous = current[index - 1];
      const chapter = current[index];
      if (!previous || !chapter) {
        return current;
      }
      const merged = {
        ...previous,
        sourceText: `${previous.sourceText}\n\n${chapter.sourceText}`.trim(),
        title: `${previous.title} / ${chapter.title}`,
      };
      const next = [...current];
      next.splice(index - 1, 2, merged);
      return next.map((entry, position) => ({ ...entry, position }));
    });
  }

  async function createBook() {
    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const created = await api.createAdminBook({
        title: bookTitle,
        author: bookAuthor || undefined,
        originalLanguage: bookLanguage || undefined,
        description: bookDescription || undefined,
        chapters: stagedChapters.map((chapter, index) => ({
          position: index + 1,
          title: chapter.title,
          slug: chapter.slug,
          sourceText: chapter.sourceText,
        })) as AdminBookChapterInput[],
      });
      await refreshBootstrap();
      setSelectedBook(created);
      setTranslations([]);
      resetBookForm();
      resetTranslationForm();
      setScreen("translations");
      setNotice(`Created draft book '${created.book.title}'.`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create book.");
    } finally {
      setIsBusy(false);
    }
  }

  async function createTranslation() {
    if (!selectedBook) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const translation = await api.createAdminTranslation(selectedBook.book.slug, {
        title: translationTitle,
        description: translationDescription || undefined,
        provider: translationProvider,
        model: translationModel,
        thinkingLevel: normalizeThinkingLevelValue(translationThinkingLevel),
        prompt: translationPrompt,
        contextBeforeChapterCount: Number(contextBeforeChapterCount || 0),
        contextAfterChapterCount: Number(contextAfterChapterCount || 0),
      });
      await refreshTranslations(selectedBook.book.slug);
      setActiveTranslation(translation);
      setSelectedChapterIndex(
        Math.min(
          translation.currentSession?.currentChapterIndex ?? 0,
          Math.max((translation.currentSession?.chapters.length ?? 1) - 1, 0),
        ),
      );
      setScreen("workspace");
      setNotice(`Created translation '${translation.name}'.`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create translation.");
    } finally {
      setIsBusy(false);
    }
  }

  async function openTranslation(translationId: string) {
    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const translation = await api.getAdminTranslation(translationId);
      hydrateActiveTranslation(translation);
      setValidation(null);
      setScreen("workspace");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load translation.");
    } finally {
      setIsBusy(false);
    }
  }

  function hydrateActiveTranslation(translation: AdminTranslationDetail) {
    setActiveTranslation(translation);
    setTranslationTitle(translation.name);
    setTranslationSlug(translation.slug);
    setTranslationDescription(translation.description ?? "");
    setTranslationProvider(translation.currentSession?.provider ?? DEFAULT_PROVIDER);
    setTranslationModel(translation.currentSession?.model ?? DEFAULT_MODEL);
    setTranslationThinkingLevel(translation.currentSession?.thinkingLevel ?? "");
    setTranslationPrompt(translation.currentSession?.prompt ?? translation.aiSystemPrompt ?? "");
    setContextBeforeChapterCount(String(translation.currentSession?.contextBeforeChapterCount ?? 1));
    setContextAfterChapterCount(String(translation.currentSession?.contextAfterChapterCount ?? 1));
    setSelectedChapterIndex(
      Math.min(
        translation.currentSession?.currentChapterIndex ?? 0,
        Math.max((translation.currentSession?.chapters.length ?? 1) - 1, 0),
      ),
    );
  }

  async function saveTranslationSettings(extra?: { status?: "draft" | "ready" | "published" }) {
    if (!activeTranslation) {
      return null;
    }

    const updated = await api.updateAdminTranslation(activeTranslation.id, {
      name: translationTitle || activeTranslation.name,
      slug: translationSlug || activeTranslation.slug,
      description: translationDescription,
      provider: translationProvider,
      model: translationModel,
      thinkingLevel: normalizeThinkingLevelValue(translationThinkingLevel),
      prompt: translationPrompt,
      status: extra?.status,
      contextBeforeChapterCount: Number(contextBeforeChapterCount || 0),
      contextAfterChapterCount: Number(contextAfterChapterCount || 0),
      currentChapterIndex: selectedChapterIndex,
    });

    hydrateActiveTranslation(updated);
    if (selectedBook) {
      await refreshTranslations(selectedBook.book.slug);
    }
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
      const updatedTranslation = await saveTranslationSettings();
      const sessionId = updatedTranslation?.currentSession?.id ?? activeSession.id;
      const result = await api.generateAdminIngestionChapter(sessionId, currentWorkspaceChapter.position);

      if (updatedTranslation?.currentSession) {
        const nextTranslation = {
          ...updatedTranslation,
          currentSession: {
            ...updatedTranslation.currentSession,
            chapters: updatedTranslation.currentSession.chapters.map((chapter) =>
              chapter.id === result.chapter.id ? result.chapter : chapter,
            ),
          },
        };
        hydrateActiveTranslation(nextTranslation);
      }

      setNotice(`Generated '${currentWorkspaceChapter.title}'.`);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Failed to generate chapter.");
    } finally {
      setIsBusy(false);
    }
  }

  async function saveCurrentChapter() {
    if (!activeSession || !currentWorkspaceChapter || !chapterEditor) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await api.saveAdminIngestionChapter(
        activeSession.id,
        currentWorkspaceChapter.position,
        JSON.stringify(serializeEditorState(chapterEditor), null, 2),
      );

      if (result.session && activeTranslation) {
        const refreshedTranslation = await api.getAdminTranslation(activeTranslation.id);
        hydrateActiveTranslation(refreshedTranslation);
        setSelectedChapterIndex(
          Math.min(currentWorkspaceChapter.position + 1, Math.max(result.session.chapters.length - 1, 0)),
        );
      }

      setNotice(`Saved '${currentWorkspaceChapter.title}'.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save chapter.");
    } finally {
      setIsBusy(false);
    }
  }

  async function validateCurrentTranslation(options?: { openResults?: boolean }) {
    if (!activeTranslation) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      await saveTranslationSettings();
      const payload = await api.validateAdminTranslation(activeTranslation.id);
      setValidation(payload);
      const matchingChapterIndex =
        currentWorkspaceChapter != null
          ? payload.chapters.findIndex((chapter) => chapter.position === currentWorkspaceChapter.position)
          : -1;
      setValidationPreviewIndex(matchingChapterIndex >= 0 ? matchingChapterIndex : 0);
      if (options?.openResults ?? true) {
        setScreen("validate");
      }
      setNotice(payload.isValid ? "Validation passed." : "Validation found issues.");
    } catch (validateError) {
      setError(validateError instanceof Error ? validateError.message : "Failed to validate translation.");
    } finally {
      setIsBusy(false);
    }
  }

  async function markTranslationStatus(status: "ready" | "published") {
    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      await saveTranslationSettings({ status });
      setNotice(status === "ready" ? "Translation marked ready." : "Translation published.");
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Failed to update draft status.");
    } finally {
      setIsBusy(false);
    }
  }

  function exportTranslationJson() {
    if (!activeTranslation?.currentSession) {
      return;
    }
    const blob = new Blob([JSON.stringify(activeTranslation.currentSession, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${activeTranslation.slug}-translation.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function openValidationIssue(issueIndex: number) {
    const issue = validation?.issues[issueIndex];
    if (!issue || issue.chapterPosition == null) {
      return;
    }
    setSelectedChapterIndex(issue.chapterPosition);
    setScreen("workspace");
  }

  function openValidationChapter(index: number) {
    setValidationPreviewIndex(index);
    const chapter = validation?.chapters[index];
    if (chapter) {
      setSelectedChapterIndex(chapter.position);
    }
  }

  function updateChapterEditor(updater: (current: ChapterEditorState) => ChapterEditorState) {
    setChapterEditor((current) => {
      if (!current) {
        return current;
      }
      const next = updater(current);
      setEditedRawResponse(JSON.stringify(serializeEditorState(next), null, 2));
      return next;
    });
  }

  function reloadEditorFromRawJson() {
    try {
      const parsed = parseEditorStateFromRaw(editedRawResponse);
      setChapterEditor(parsed);
      setNotice("Reloaded the structured editor from raw JSON.");
      setError(null);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Failed to parse raw JSON.");
    }
  }

  const breadcrumbs = buildBreadcrumbs({
    screen,
    selectedBookTitle: selectedBook?.book.title ?? null,
    activeTranslationName: activeTranslation?.name ?? null,
    onBooks: () => setScreen("books"),
    onCreateBook: () => setScreen("create-book"),
    onTranslations: selectedBook ? () => setScreen("translations") : null,
    onWorkspace: activeTranslation ? () => setScreen("workspace") : null,
  });

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="flex min-h-screen w-full flex-col gap-8 px-6 py-8 lg:px-10">
        <header className="rounded-[24px] border border-border/70 bg-white/85 px-5 py-4 shadow-panel backdrop-blur">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setScreen("books")}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                screen === "books"
                  ? "bg-ink text-paper"
                  : "border border-border/70 bg-paper/80 text-ink hover:border-accent/50"
              }`}
            >
              Books
            </button>
            <button
              type="button"
              onClick={() => setScreen("create-book")}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                screen === "create-book"
                  ? "bg-ink text-paper"
                  : "border border-border/70 bg-paper/80 text-ink hover:border-accent/50"
              }`}
            >
              Create Book
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="ml-auto rounded-full border border-border/70 bg-paper/80 px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent/50"
            >
              Settings
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-ink/60">
            {breadcrumbs.map((crumb, index) => (
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
        </header>

        {isLoading ? <Panel title="Loading">Loading admin data.</Panel> : null}
        {error ? <Panel title="Error">{error}</Panel> : null}
        {notice ? <Panel title="Status">{notice}</Panel> : null}

        {screen === "books" ? (
          <section className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <Panel title="Books">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {(bootstrap?.books ?? []).map((book) => (
                  <button
                    key={book.id}
                    type="button"
                    onClick={() => void openBook(book.slug)}
                    className="rounded-[24px] border border-border/70 bg-paper/80 p-5 text-left transition hover:border-accent/50 hover:bg-white"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{book.status}</p>
                      <span className="text-xs text-ink/55">{formatTimestamp(book.latestActivityAt)}</span>
                    </div>
                    <h2 className="mt-3 font-display text-3xl text-ink">{book.title}</h2>
                    <p className="mt-2 text-sm text-ink/65">{book.author}</p>
                    <p className="mt-4 text-sm leading-7 text-ink/75">{book.description || "No description yet."}</p>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-ink/70">
                      <Metric label="Chapters" value={String(book.chapterCount)} />
                      <Metric label="Translations" value={String(book.translationCount)} />
                      <Metric label="Saved" value={`${book.savedChapterCount}/${book.chapterCount || 0}`} />
                      <Metric label="Ready" value={String(book.readyTranslationCount)} />
                    </div>
                  </button>
                ))}
              </div>
            </Panel>

            <Panel title="Create New">
              <p className="text-base leading-7 text-ink/70">
                Paste a source text, auto-split it, then hand-edit the staged chapter list before anything is written to
                D1 or R2.
              </p>
              <div className="mt-6">
                <ActionButton label="Create New Book" onClick={() => setScreen("create-book")} tone="accent" />
              </div>
            </Panel>
          </section>
        ) : null}

        {screen === "create-book" ? (
          <section className="grid gap-6 xl:grid-cols-[380px_1fr]">
            <Panel title="Book Details">
              <div className="space-y-4">
                <InputField label="Title" value={bookTitle} onChange={setBookTitle} />
                <InputField label="Author" value={bookAuthor} onChange={setBookAuthor} />
                <InputField label="Original Language" value={bookLanguage} onChange={setBookLanguage} />
                <TextareaField label="Description" value={bookDescription} onChange={setBookDescription} rows={5} />
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
                  <InputField label="Heading Regex" value={headingPattern} onChange={setHeadingPattern} />
                ) : null}
                {splitMode === "delimiter" ? (
                  <InputField label="Delimiter" value={delimiter} onChange={setDelimiter} />
                ) : null}
                <ActionButton label="Back To Books" onClick={() => setScreen("books")} />
              </div>
            </Panel>

            <div className="grid gap-6">
              <Panel title="Paste Source Text">
                <TextareaField
                  label="Full Text"
                  value={bookRawText}
                  onChange={setBookRawText}
                  rows={16}
                  placeholder="Paste the full source text here."
                />
                <div className="mt-4 flex flex-wrap gap-3">
                  <ActionButton
                    label="Load Auto-Split Into Editor"
                    onClick={seedStageFromPreview}
                    tone="accent"
                    disabled={chapterPreview.length === 0}
                  />
                  <span className="text-sm text-ink/60">{chapterPreview.length} chapter split(s) detected.</span>
                </div>
              </Panel>

              <Panel title="Editable Chapter Staging">
                <div className="space-y-4">
                  {stagedChapters.map((chapter, index) => (
                    <div
                      key={`${chapter.slug}-${index}`}
                      className="rounded-2xl border border-border/60 bg-paper/80 p-4"
                    >
                      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
                        <InputField
                          label={`Chapter ${index + 1} Title`}
                          value={chapter.title}
                          onChange={(value) => updateStagedChapter(index, "title", value)}
                        />
                        <InputField
                          label="Slug"
                          value={chapter.slug}
                          onChange={(value) => updateStagedChapter(index, "slug", value)}
                        />
                        <div className="flex flex-wrap items-end gap-2">
                          <MiniButton label="Up" onClick={() => moveStagedChapter(index, -1)} disabled={index === 0} />
                          <MiniButton
                            label="Down"
                            onClick={() => moveStagedChapter(index, 1)}
                            disabled={index === stagedChapters.length - 1}
                          />
                          <MiniButton label="Split" onClick={() => splitStagedChapter(index)} />
                          <MiniButton label="Merge" onClick={() => mergeStagedChapter(index)} disabled={index === 0} />
                          <MiniButton label="Delete" onClick={() => deleteStagedChapter(index)} />
                        </div>
                      </div>
                      <div className="mt-4">
                        <TextareaField
                          label="Source Text"
                          value={chapter.sourceText}
                          onChange={(value) => updateStagedChapter(index, "sourceText", value)}
                          rows={8}
                        />
                      </div>
                    </div>
                  ))}
                  {stagedChapters.length === 0 ? (
                    <p className="text-base leading-7 text-ink/65">
                      Generate an auto-split preview, then edit the staged chapters here before creating the book.
                    </p>
                  ) : null}
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <ActionButton
                    label={isBusy ? "Saving..." : "Create Book"}
                    onClick={createBook}
                    tone="accent"
                    disabled={isBusy || !bookTitle.trim() || stagedChapters.length === 0}
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
                <h2 className="font-display text-4xl text-ink">{selectedBook.book.title}</h2>
                <p className="text-sm text-ink/65">{selectedBook.book.author}</p>
                <p className="text-sm leading-7 text-ink/75">
                  {selectedBook.book.description || "No description yet."}
                </p>
                <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border/70 bg-paper/75 p-4 text-sm text-ink/70">
                  <Metric label="Chapters" value={String(selectedBook.chapters.length)} />
                  <Metric label="Translations" value={String(translations.length)} />
                </div>
                <ActionButton label="Back To Books" onClick={() => setScreen("books")} />
              </div>
            </Panel>

            <div className="grid gap-6">
              <Panel title="Translations">
                <div className="grid gap-4 md:grid-cols-2">
                  {translations.map((translation) => (
                    <button
                      key={translation.id}
                      type="button"
                      onClick={() => void openTranslation(translation.id)}
                      className="rounded-[24px] border border-border/70 bg-paper/80 p-5 text-left transition hover:border-accent/50 hover:bg-white"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                          {translation.status}
                        </p>
                        <span className="text-xs text-ink/55">{formatTimestamp(translation.latestActivityAt)}</span>
                      </div>
                      <h3 className="mt-3 font-display text-3xl text-ink">{translation.name}</h3>
                      <p className="mt-2 text-sm leading-7 text-ink/70">
                        {translation.description || "No description yet."}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink/65">
                        <span className="rounded-full border border-border/70 bg-white/75 px-3 py-1">
                          {formatProviderLabel(translation.latestSession?.provider ?? DEFAULT_PROVIDER)} ·{" "}
                          {translation.latestSession?.model ?? DEFAULT_MODEL}
                        </span>
                        <span className="rounded-full border border-border/70 bg-white/75 px-3 py-1">
                          {formatThinkingSummary(translation.latestSession)}
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-ink/70">
                        <Metric label="Saved" value={`${translation.savedChapterCount}/${translation.chapterCount}`} />
                        <Metric label="Generated" value={String(translation.generatedChapterCount)} />
                        <Metric label="Pending" value={String(translation.pendingChapterCount)} />
                        <Metric label="Runs" value={String(translation.sessionCount)} />
                      </div>
                    </button>
                  ))}
                </div>
              </Panel>

              <Panel title="Create Translation">
                <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
                  <InputField label="Translation Name" value={translationTitle} onChange={setTranslationTitle} />
                  <ActionButton
                    label={isBusy ? "Creating..." : "Create Translation"}
                    onClick={createTranslation}
                    tone="accent"
                    disabled={isBusy || !translationTitle.trim()}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowAdvancedTranslationSettings((current) => !current)}
                  className="mt-4 text-sm font-semibold text-accent"
                >
                  {showAdvancedTranslationSettings ? "Hide advanced settings" : "Show advanced settings"}
                </button>
                {showAdvancedTranslationSettings ? (
                  <>
                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <InputField
                        label="Description"
                        value={translationDescription}
                        onChange={setTranslationDescription}
                      />
                    </div>
                    <div className="mt-4">
                      <TranslationAiSettingsRow
                        provider={translationProvider}
                        onProviderChange={setTranslationProvider}
                        model={translationModel}
                        onModelChange={setTranslationModel}
                        contextBeforeChapterCount={contextBeforeChapterCount}
                        onContextBeforeChapterCountChange={setContextBeforeChapterCount}
                        contextAfterChapterCount={contextAfterChapterCount}
                        onContextAfterChapterCountChange={setContextAfterChapterCount}
                        thinkingLevel={translationThinkingLevel}
                        onThinkingLevelChange={setTranslationThinkingLevel}
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
                  </>
                ) : null}
              </Panel>
            </div>
          </section>
        ) : null}

        {screen === "workspace" && activeTranslation && activeSession ? (
          <section className="grid gap-6 xl:grid-cols-[320px_1fr]">
            <Panel title="Translation">
              <div className="rounded-2xl border border-border/60 bg-paper/70 p-4 text-sm text-ink/70">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Translation</p>
                <h3 className="mt-2 font-display text-3xl text-ink">{activeTranslation.name}</h3>
                <p className="mt-2 leading-7">{activeTranslation.description || "No description yet."}</p>
              </div>
              <div className="mt-4 space-y-3">
                {activeSession.chapters.map((chapter, index) => {
                  const issueCount =
                    validation?.chapters.find((validationChapter) => validationChapter.position === chapter.position)
                      ?.issues.length ?? 0;
                  return (
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
                          <p className="font-semibold text-ink">{chapter.title}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-accent">{chapter.slug}</p>
                        </div>
                        <StatusPill status={chapter.status} />
                      </div>
                      <p className="mt-2 text-sm text-ink/60">
                        {issueCount > 0 ? `${issueCount} validation issues` : "No flagged issues"}
                      </p>
                    </button>
                  );
                })}
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <ActionButton label="Back To Translations" onClick={() => setScreen("translations")} />
                <ActionButton
                  label="Validate Translation"
                  onClick={() => void validateCurrentTranslation()}
                  tone="accent"
                />
              </div>
            </Panel>

            <div className="grid gap-6">
              <Panel title="Translation Settings">
                <div className="grid gap-4 lg:grid-cols-2">
                  <InputField label="Translation Name" value={translationTitle} onChange={setTranslationTitle} />
                  <InputField label="Slug" value={translationSlug} onChange={setTranslationSlug} />
                  <InputField label="Description" value={translationDescription} onChange={setTranslationDescription} />
                </div>
                <div className="mt-4">
                  <TranslationAiSettingsRow
                    provider={translationProvider}
                    onProviderChange={setTranslationProvider}
                    model={translationModel}
                    onModelChange={setTranslationModel}
                    contextBeforeChapterCount={contextBeforeChapterCount}
                    onContextBeforeChapterCountChange={setContextBeforeChapterCount}
                    contextAfterChapterCount={contextAfterChapterCount}
                    onContextAfterChapterCountChange={setContextAfterChapterCount}
                    thinkingLevel={translationThinkingLevel}
                    onThinkingLevelChange={setTranslationThinkingLevel}
                  />
                </div>
                <div className="mt-4">
                  <TextareaField label="Prompt" value={translationPrompt} onChange={setTranslationPrompt} rows={8} />
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <ActionButton
                    label={
                      isBusy && translationMetadataIsDirty
                        ? "Saving..."
                        : translationMetadataIsDirty
                          ? "Save Translation Metadata"
                          : "Translation Metadata Saved"
                    }
                    onClick={() => void saveTranslationSettings()}
                    disabled={isBusy || !translationMetadataIsDirty}
                  />
                  <ActionButton
                    label={isBusy ? "Generating..." : "Generate Current Chapter"}
                    onClick={generateCurrentChapter}
                    tone="accent"
                    disabled={isBusy || !currentWorkspaceChapter}
                  />
                </div>
              </Panel>

              {currentWorkspaceChapter && chapterEditor ? (
                <>
                  <section className="rounded-[28px] border border-border/70 bg-white/80 p-6 shadow-panel backdrop-blur">
                    <button
                      type="button"
                      onClick={() => setWorkspaceSourceExpanded((current) => !current)}
                      className="flex w-full items-center justify-between gap-4 text-left"
                      aria-expanded={workspaceSourceExpanded}
                    >
                      <div>
                        <h2 className="font-display text-3xl text-ink">{`Source: ${currentWorkspaceChapter.title}`}</h2>
                        <p className="mt-2 text-sm text-ink/65">
                          {workspaceSourceExpanded ? "Hide source text" : "Show source text"}
                        </p>
                      </div>
                      <span className="rounded-full border border-border/70 px-4 py-2 text-sm font-semibold text-ink">
                        {workspaceSourceExpanded ? "Collapse" : "Expand"}
                      </span>
                    </button>
                    {workspaceSourceExpanded ? (
                      <div className="mt-5 space-y-5">
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-paper/60 p-4">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                              Source Reconstruction
                            </p>
                            <p
                              className={`mt-2 text-sm leading-6 ${
                                sourceDiff?.hasMismatch
                                  ? "text-red-700"
                                  : currentValidationChapter?.issues.length
                                    ? "text-amber-800"
                                    : "text-ink/70"
                              }`}
                            >
                              {sourceDiff?.hasMismatch
                                ? "Current chapter chunks do not reconstruct the source text exactly."
                                : "Current chapter chunks reconstruct the source text exactly."}
                            </p>
                            {currentValidationChapter?.issues.length ? (
                              <p className="mt-1 text-sm leading-6 text-ink/60">
                                Last validation run: {currentValidationChapter.issues.length} issue(s) on this chapter.
                              </p>
                            ) : null}
                          </div>
                          <ActionButton
                            label={isBusy ? "Re-Validating..." : "Re-Validate Translation"}
                            onClick={() => void validateCurrentTranslation({ openResults: false })}
                            disabled={isBusy}
                          />
                        </div>

                        {sourceDiff?.hasMismatch ? (
                          <SourceDiffPreview diff={sourceDiff} />
                        ) : (
                          <div className="rounded-2xl border border-border/60 bg-paper/55 p-4">
                            <p className="whitespace-pre-wrap text-base leading-7 text-ink/80">
                              {currentWorkspaceChapter.sourceText}
                            </p>
                          </div>
                        )}

                        {chapterIsDirty ? (
                          <p className="text-sm leading-6 text-ink/60">
                            The diff above is computed from unsaved editor changes. Save the chapter before
                            re-validating if you want server-side validation to include those edits.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </section>

                  <Panel title="Structured Chapter Review">
                    <div className="grid gap-3 lg:grid-cols-2">
                      <InputField
                        label="Chapter Title"
                        value={chapterEditor.chapterTitle}
                        onChange={(value) =>
                          updateChapterEditor((current) => ({
                            ...current,
                            chapterTitle: value,
                          }))
                        }
                      />
                      <TextareaField
                        label="Editor Notes"
                        value={chapterEditor.notes}
                        onChange={(value) =>
                          updateChapterEditor((current) => ({
                            ...current,
                            notes: value,
                          }))
                        }
                        rows={3}
                      />
                    </div>
                    <section className="mt-4 space-y-4">
                      <AlignedTranslationReview
                        chunks={chapterEditor.chunks}
                        onChange={(chunks) =>
                          updateChapterEditor((current) => ({
                            ...current,
                            chunks,
                          }))
                        }
                      />
                    </section>
                    <button
                      type="button"
                      onClick={() => setShowRawJsonEditor((current) => !current)}
                      className="mt-4 text-sm font-semibold text-accent"
                    >
                      {showRawJsonEditor ? "Hide raw JSON" : "Show raw JSON"}
                    </button>
                    {showRawJsonEditor ? (
                      <div className="mt-4">
                        <textarea
                          className="min-h-[260px] w-full rounded-2xl border border-border/70 bg-paper/70 px-4 py-3 font-mono text-sm leading-6 text-ink outline-none transition focus:border-accent"
                          value={editedRawResponse}
                          onChange={(event) => setEditedRawResponse(event.target.value)}
                        />
                        <div className="mt-3">
                          <ActionButton label="Reload Editor From Raw JSON" onClick={reloadEditorFromRawJson} />
                        </div>
                      </div>
                    ) : null}
                    <div className="mt-6 flex justify-end">
                      <ActionButton
                        label={
                          isBusy && chapterIsDirty
                            ? "Saving..."
                            : chapterIsDirty
                              ? "Save Chapter To Translation"
                              : "Chapter Saved"
                        }
                        onClick={saveCurrentChapter}
                        tone="accent"
                        disabled={isBusy || !chapterIsDirty}
                      />
                    </div>
                  </Panel>
                </>
              ) : null}
            </div>
          </section>
        ) : null}

        {screen === "validate" && validation && activeTranslation ? (
          <section className="grid gap-6 xl:grid-cols-[320px_1fr]">
            <Panel title="Validation Summary">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">
                {validation.isValid ? "Ready for finish line" : "Issues found"}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-ink/70">
                <Metric label="Chapters" value={String(validation.chapters.length)} />
                <Metric
                  label="Errors"
                  value={String(validation.issues.filter((issue) => issue.level === "error").length)}
                />
                <Metric
                  label="Warnings"
                  value={String(validation.issues.filter((issue) => issue.level === "warning").length)}
                />
                <Metric label="Status" value={activeTranslation.status} />
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <ActionButton label="Continue Editing" onClick={() => setScreen("workspace")} />
                <ActionButton
                  label="Mark Ready"
                  onClick={() => void markTranslationStatus("ready")}
                  tone="accent"
                  disabled={!validation.isValid || isBusy}
                />
                <ActionButton
                  label="Publish Translation"
                  onClick={() => void markTranslationStatus("published")}
                  disabled={!validation.isValid || isBusy}
                />
                <ActionButton label="Export Translation JSON" onClick={exportTranslationJson} />
              </div>
            </Panel>

            <div className="grid gap-6">
              <Panel title="Actionable Issues">
                <div className="space-y-3">
                  {validation.issues.length > 0 ? (
                    validation.issues.map((issue, index) => (
                      <button
                        key={`${issue.level}-${index}`}
                        type="button"
                        onClick={() => openValidationIssue(index)}
                        className={`w-full rounded-2xl border p-3 text-left text-sm leading-6 ${
                          issue.level === "error"
                            ? "border-red-200 bg-red-50 text-red-800"
                            : "border-amber-200 bg-amber-50 text-amber-900"
                        }`}
                      >
                        <span className="font-semibold">{issue.chapterSlug ?? "Translation"}</span> {issue.message}
                      </button>
                    ))
                  ) : (
                    <p className="text-base leading-7 text-ink/70">No validation issues found.</p>
                  )}
                </div>
              </Panel>

              <Panel title="Chapter Checks">
                <div className="grid gap-3 md:grid-cols-2">
                  {validation.chapters.map((chapter, index) => (
                    <button
                      key={chapter.slug + chapter.position}
                      type="button"
                      onClick={() => openValidationChapter(index)}
                      className={`rounded-2xl border px-4 py-3 text-left transition ${
                        validationPreviewIndex === index
                          ? "border-accent bg-accent/10"
                          : "border-border/70 bg-paper/80 hover:border-accent/50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-ink">{chapter.title}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-accent">{chapter.slug}</p>
                        </div>
                        <StatusPill status={chapter.status} />
                      </div>
                      <p className="mt-2 text-sm leading-6 text-ink/65">
                        {chapter.issues.length > 0
                          ? `${chapter.issues.length} issue(s) · Open in workspace`
                          : "No issues"}
                      </p>
                    </button>
                  ))}
                </div>
              </Panel>

              {validationPreviewChapter ? (
                <Panel title="Side-by-Side Preview">
                  <ChapterSideBySidePreview chapter={validationPreviewChapter} />
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
            <div className="mt-6 space-y-6">
              <section className="space-y-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Credentials</p>
                <InputField
                  label="OpenRouter API Key"
                  value={settingsOpenRouterApiKey}
                  onChange={setSettingsOpenRouterApiKey}
                  type="password"
                />
                <InputField
                  label="Google Gemini API Key"
                  value={settingsGoogleApiKey}
                  onChange={setSettingsGoogleApiKey}
                  type="password"
                />
              </section>
              <section className="space-y-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Generation Defaults</p>
                <SelectField
                  label="Default Provider"
                  value={settingsProvider}
                  onChange={(value) => setSettingsProvider(value as AiProvider)}
                  options={PROVIDER_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                />
                <InputField label="Default Model" value={settingsModel} onChange={setSettingsModel} />
                <TextareaField label="Default Prompt" value={settingsPrompt} onChange={setSettingsPrompt} rows={10} />
              </section>
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

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[28px] border border-border/70 bg-white/80 p-6 shadow-panel backdrop-blur">
      <h2 className="font-display text-3xl text-ink">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function TranslationAiSettingsRow({
  provider,
  onProviderChange,
  model,
  onModelChange,
  contextBeforeChapterCount,
  onContextBeforeChapterCountChange,
  contextAfterChapterCount,
  onContextAfterChapterCountChange,
  thinkingLevel,
  onThinkingLevelChange,
}: {
  provider: AiProvider;
  onProviderChange: (value: AiProvider) => void;
  model: string;
  onModelChange: (value: string) => void;
  contextBeforeChapterCount: string;
  onContextBeforeChapterCountChange: (value: string) => void;
  contextAfterChapterCount: string;
  onContextAfterChapterCountChange: (value: string) => void;
  thinkingLevel: string;
  onThinkingLevelChange: (value: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-paper/70 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">AI Settings</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.8fr)_repeat(3,minmax(0,1fr))]">
        <div className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Provider</span>
          <CompactSelect
            value={provider}
            onChange={(value) => onProviderChange(value as AiProvider)}
            options={PROVIDER_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            ariaLabel="Provider"
          />
        </div>
        <CompactInputField label="Model" value={model} onChange={onModelChange} className="xl:col-span-2" />
        <CompactInputField
          label="Context Before"
          value={contextBeforeChapterCount}
          onChange={onContextBeforeChapterCountChange}
        />
        <CompactInputField
          label="Context After"
          value={contextAfterChapterCount}
          onChange={onContextAfterChapterCountChange}
        />
        <div className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Thinking Level</span>
          <CompactSelect
            value={thinkingLevel}
            onChange={onThinkingLevelChange}
            options={THINKING_LEVEL_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            ariaLabel="Thinking level"
          />
        </div>
      </div>
    </div>
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
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
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
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{label}</span>
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

function CompactInputField({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`grid gap-2 ${className ?? ""}`.trim()}>
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="rounded-xl border border-border/70 bg-white/85 px-3 py-2 text-sm text-ink outline-none transition focus:border-accent"
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
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{label}</span>
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
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{label}</span>
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

function MiniButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-border/70 px-3 py-2 text-xs font-semibold text-ink disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-white/70 p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent/80">{label}</p>
      <p className="mt-1 text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "saved"
      ? "bg-emerald-100 text-emerald-800"
      : status === "generated" || status === "ready" || status === "published"
        ? "bg-amber-100 text-amber-800"
        : status === "error" || status === "failed"
          ? "bg-red-100 text-red-800"
          : "bg-stone-200 text-stone-700";

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${tone}`}>{status}</span>
  );
}

function AlignedTranslationReview({
  chunks,
  onChange,
}: {
  chunks: Array<{
    originalText: string;
    translatedText: string;
    type: "prose" | "verse";
  }>;
  onChange: (
    chunks: Array<{
      originalText: string;
      translatedText: string;
      type: "prose" | "verse";
    }>,
  ) => void;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-paper/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Aligned Translation Review</p>
        <div className="flex flex-wrap gap-2">
          <MiniButton
            label="Add Chunk"
            onClick={() =>
              onChange([
                ...chunks,
                {
                  originalText: "",
                  translatedText: "",
                  type: "prose",
                },
              ])
            }
          />
        </div>
      </div>
      <div className="mt-3 space-y-3">
        {chunks.map((chunk, index) => {
          return (
            <div
              key={`translation-${index}`}
              className="grid gap-4 rounded-xl border border-border/50 bg-white/45 p-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]"
            >
              <div className="min-w-0 border-r border-border/35 pr-4 xl:pr-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent/80">Source</p>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent/75">T{index + 1}</p>
                </div>
                <textarea
                  rows={Math.max(5, chunk.originalText.split("\n").length)}
                  value={chunk.originalText}
                  onChange={(event) =>
                    onChange(
                      chunks.map((entry, chunkIndex) =>
                        chunkIndex === index ? { ...entry, originalText: event.target.value } : entry,
                      ),
                    )
                  }
                  placeholder="Original text"
                  className="mt-3 w-full rounded-xl border border-border/60 bg-paper/65 px-3 py-2 text-base leading-7 text-ink outline-none transition focus:border-accent"
                />
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <CompactSelect
                    value={chunk.type}
                    onChange={(value) =>
                      onChange(
                        chunks.map((entry, chunkIndex) =>
                          chunkIndex === index ? { ...entry, type: value as "prose" | "verse" } : entry,
                        ),
                      )
                    }
                    options={[
                      { value: "prose", label: "Prose" },
                      { value: "verse", label: "Verse" },
                    ]}
                    ariaLabel={`Chunk type for translation ${index + 1}`}
                  />
                  <MiniButton
                    label="Add Below"
                    onClick={() =>
                      onChange([
                        ...chunks.slice(0, index + 1),
                        {
                          originalText: "",
                          translatedText: "",
                          type: chunk.type,
                        },
                        ...chunks.slice(index + 1),
                      ])
                    }
                  />
                  <MiniButton
                    label="Delete"
                    onClick={() => onChange(chunks.filter((_, chunkIndex) => chunkIndex !== index))}
                    disabled={chunks.length === 1}
                  />
                </div>

                <textarea
                  rows={5}
                  value={chunk.translatedText}
                  onChange={(event) =>
                    onChange(
                      chunks.map((entry, chunkIndex) =>
                        chunkIndex === index ? { ...entry, translatedText: event.target.value } : entry,
                      ),
                    )
                  }
                  placeholder="Translated text"
                  className="mt-3 w-full rounded-xl border border-border/60 bg-paper/65 px-3 py-2 text-base leading-7 text-ink outline-none transition focus:border-accent"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompactSelect({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  ariaLabel: string;
}) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-full border border-border/70 bg-paper/60 px-3 py-1.5 text-sm font-semibold text-ink outline-none transition focus:border-accent"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function ChapterSideBySidePreview({
  chapter,
}: {
  chapter: NonNullable<AdminTranslationValidationPayload["session"]>["chapters"][number];
}) {
  return (
    <div className="divide-y divide-border/35">
      {(chapter.translationDocument?.chunks ?? []).map((chunk) => {
        return (
          <div key={chunk.id} className="grid gap-4 py-4 md:grid-cols-2 md:gap-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Source</p>
              <p className="mt-3 whitespace-pre-wrap font-display text-2xl leading-9 text-ink">{chunk.originalText}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Translation · {chunk.id}</p>
              <p className="mt-3 whitespace-pre-wrap text-lg leading-8 text-ink/80">{chunk.translatedText}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SourceDiffPreview({
  diff,
}: {
  diff: {
    sourceText: string;
    reconstructedText: string;
    hasMismatch: boolean;
    lines: DiffLine[];
  };
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <DiffTextCard label="Source Text" tone="source" text={diff.sourceText} emptyLabel="Source text is empty." />
        <DiffTextCard
          label="Reconstructed From Chunks"
          tone="reconstructed"
          text={diff.reconstructedText}
          emptyLabel="Reconstructed text is empty."
        />
      </div>
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-paper/60">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border-b border-border/60 bg-white/70">
          <div className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-accent">Source</div>
          <div className="border-l border-border/60 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            Reconstructed
          </div>
        </div>
        <div className="divide-y divide-border/40">
          {diff.lines.map((line, index) => (
            <div key={`${line.leftLineNumber}-${line.rightLineNumber}-${index}`} className="grid grid-cols-2">
              <DiffLineCell segments={line.left} lineNumber={line.leftLineNumber} tone="source" />
              <DiffLineCell segments={line.right} lineNumber={line.rightLineNumber} tone="reconstructed" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DiffTextCard({
  label,
  text,
  emptyLabel,
  tone,
}: {
  label: string;
  text: string;
  emptyLabel: string;
  tone: "source" | "reconstructed";
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-paper/55 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{label}</p>
      <div className={`mt-3 rounded-xl border px-4 py-3 ${tone === "source" ? "bg-red-50/70" : "bg-emerald-50/70"}`}>
        <p className="whitespace-pre-wrap text-sm leading-6 text-ink/85">{text || emptyLabel}</p>
      </div>
    </div>
  );
}

function DiffLineCell({
  segments,
  lineNumber,
  tone,
}: {
  segments: DiffSegment[];
  lineNumber: number | null;
  tone: "source" | "reconstructed";
}) {
  return (
    <div className={`flex gap-3 px-4 py-3 ${tone === "reconstructed" ? "border-l border-border/60" : ""}`}>
      <span className="w-8 shrink-0 pt-0.5 text-right font-mono text-xs text-ink/35">{lineNumber ?? ""}</span>
      <p className="min-w-0 whitespace-pre-wrap break-words font-mono text-sm leading-6 text-ink/85">
        {segments.length > 0 ? segments.map((segment, index) => renderDiffSegment(segment, tone, index)) : " "}
      </p>
    </div>
  );
}

function renderDiffSegment(segment: DiffSegment, tone: "source" | "reconstructed", index: number) {
  if (segment.kind === "equal") {
    return <span key={index}>{segment.value}</span>;
  }

  const className =
    tone === "source"
      ? "rounded bg-red-200/90 px-0.5 text-red-900"
      : "rounded bg-emerald-200/90 px-0.5 text-emerald-950";

  return (
    <mark key={index} className={className}>
      {segment.value}
    </mark>
  );
}

function buildChapterEditorState(chapter: AdminIngestionChapterRecord): ChapterEditorState {
  if (chapter.rawResponse?.trim()) {
    try {
      return parseEditorStateFromRaw(chapter.rawResponse);
    } catch {
      // Fall back to normalized documents below.
    }
  }

  return {
    chapterTitle: chapter.title,
    notes: chapter.notes ?? "",
    chunks: (
      chapter.translationDocument?.chunks ?? [
        {
          originalText: "",
          translatedText: "",
          type: "prose",
          id: "t1",
          ordinal: 1,
        },
      ]
    ).map((chunk) => ({
      originalText: chunk.originalText,
      translatedText: chunk.translatedText,
      type: chunk.type,
    })),
  };
}

function normalizeThinkingLevelValue(value: string): "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (THINKING_LEVEL_OPTIONS.some((option) => option.value === trimmed)) {
    return trimmed as "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  }

  return null;
}

function formatThinkingSummary(
  session:
    | {
        provider?: AiProvider | null;
        thinkingLevel: string | null;
      }
    | null
    | undefined,
): string {
  if (!session?.thinkingLevel) {
    return "Thinking default";
  }

  if (session.thinkingLevel === "none") {
    return "Thinking off";
  }

  return `Thinking ${session.thinkingLevel}`;
}

function normalizeProviderValue(value: string | null | undefined): AiProvider {
  return value === "openrouter" ? "openrouter" : DEFAULT_PROVIDER;
}

function formatProviderLabel(provider: AiProvider): string {
  return provider === "openrouter" ? "OpenRouter" : "Gemini SDK";
}

function buildTranslationMetadataSnapshot(input: {
  activeTranslation: AdminTranslationDetail;
  activeSession: AdminTranslationDetail["currentSession"];
}) {
  return {
    name: input.activeTranslation.name.trim(),
    slug: input.activeTranslation.slug.trim(),
    description: (input.activeTranslation.description ?? "").trim(),
    provider: input.activeSession?.provider ?? DEFAULT_PROVIDER,
    model: (input.activeSession?.model ?? DEFAULT_MODEL).trim(),
    thinkingLevel: input.activeSession?.thinkingLevel ?? null,
    prompt: input.activeSession?.prompt ?? input.activeTranslation.aiSystemPrompt ?? "",
    contextBeforeChapterCount: input.activeSession?.contextBeforeChapterCount ?? 1,
    contextAfterChapterCount: input.activeSession?.contextAfterChapterCount ?? 1,
  };
}

function buildBreadcrumbs(input: {
  screen: AdminScreen;
  selectedBookTitle: string | null;
  activeTranslationName: string | null;
  onBooks: () => void;
  onCreateBook: () => void;
  onTranslations: (() => void) | null;
  onWorkspace: (() => void) | null;
}) {
  const breadcrumbs: Array<{
    label: string;
    isCurrent: boolean;
    onClick: (() => void) | null;
  }> = [
    {
      label: "Admin",
      isCurrent: input.screen === "books",
      onClick: input.onBooks,
    },
  ];

  if (input.screen === "books") {
    breadcrumbs.push({ label: "Books", isCurrent: true, onClick: null });
    return breadcrumbs;
  }

  if (input.screen === "create-book") {
    breadcrumbs.push({
      label: "Books",
      isCurrent: false,
      onClick: input.onBooks,
    });
    breadcrumbs.push({
      label: "Create Book",
      isCurrent: true,
      onClick: null,
    });
    return breadcrumbs;
  }

  breadcrumbs.push({
    label: "Books",
    isCurrent: false,
    onClick: input.onBooks,
  });

  if (input.selectedBookTitle) {
    breadcrumbs.push({
      label: input.selectedBookTitle,
      isCurrent: input.screen === "translations",
      onClick: input.onTranslations,
    });
  }

  if (input.screen === "translations") {
    return breadcrumbs;
  }

  if (input.activeTranslationName) {
    breadcrumbs.push({
      label: input.activeTranslationName,
      isCurrent: input.screen === "workspace",
      onClick: input.onWorkspace,
    });
  }

  if (input.screen === "workspace") {
    breadcrumbs.push({ label: "Workspace", isCurrent: true, onClick: null });
  }

  if (input.screen === "validate") {
    breadcrumbs.push({ label: "Validation", isCurrent: true, onClick: null });
  }

  return breadcrumbs;
}

function parseEditorStateFromRaw(rawResponse: string): ChapterEditorState {
  const parsed = JSON.parse(rawResponse) as {
    chapterTitle?: string;
    notes?: string;
    chunks?: Array<{
      originalText?: string;
      translatedText?: string;
      type?: "prose" | "verse";
    }>;
  };

  const chunks: ChapterEditorState["chunks"] = (parsed.chunks ?? []).map((chunk) => ({
    originalText: chunk.originalText?.trim() ?? "",
    translatedText: chunk.translatedText?.trim() ?? "",
    type: chunk.type === "verse" ? "verse" : "prose",
  }));

  if (chunks.length === 0) {
    throw new Error("Raw JSON must include chunks.");
  }

  return {
    chapterTitle: parsed.chapterTitle ?? "Untitled Chapter",
    notes: parsed.notes ?? "",
    chunks,
  };
}

function serializeEditorState(editor: ChapterEditorState) {
  return {
    chapterTitle: editor.chapterTitle,
    notes: editor.notes,
    chunks: editor.chunks.map((chunk) => ({
      originalText: chunk.originalText,
      translatedText: chunk.translatedText,
      type: chunk.type,
    })),
  };
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "No activity";
  }
  return new Date(value).toLocaleDateString();
}

function buildSideBySideDiff(sourceText: string, reconstructedText: string): DiffLine[] {
  const leftLines = sourceText.split("\n");
  const rightLines = reconstructedText.split("\n");
  const operations = diffLines(leftLines, rightLines);
  const rows: DiffLine[] = [];
  let leftLineNumber = 1;
  let rightLineNumber = 1;

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];

    if (operation?.type === "equal") {
      rows.push({
        left: [{ value: operation.left, kind: "equal" }],
        right: [{ value: operation.right, kind: "equal" }],
        leftLineNumber,
        rightLineNumber,
        hasChanges: false,
      });
      leftLineNumber += 1;
      rightLineNumber += 1;
      continue;
    }

    const removed: string[] = [];
    const added: string[] = [];
    while (operations[index]?.type === "remove") {
      const entry = operations[index];
      if (entry?.type !== "remove") {
        break;
      }
      removed.push(entry.left);
      index += 1;
    }
    while (operations[index]?.type === "add") {
      const entry = operations[index];
      if (entry?.type !== "add") {
        break;
      }
      added.push(entry.right);
      index += 1;
    }
    index -= 1;

    const pairCount = Math.max(removed.length, added.length);
    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      const left = removed[pairIndex];
      const right = added[pairIndex];
      const highlighted = highlightChangedLine(left, right);
      rows.push({
        left: highlighted.left,
        right: highlighted.right,
        leftLineNumber: left != null ? leftLineNumber++ : null,
        rightLineNumber: right != null ? rightLineNumber++ : null,
        hasChanges: true,
      });
    }
  }

  return rows;
}

function diffLines(leftLines: string[], rightLines: string[]) {
  const leftLength = leftLines.length;
  const rightLength = rightLines.length;
  const dp = Array.from({ length: leftLength + 1 }, () => Array<number>(rightLength + 1).fill(0));

  for (let leftIndex = leftLength - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = rightLength - 1; rightIndex >= 0; rightIndex -= 1) {
      const row = dp[leftIndex];
      if (!row) {
        continue;
      }
      const leftLine = leftLines[leftIndex] ?? "";
      const rightLine = rightLines[rightIndex] ?? "";
      const down = dp[leftIndex + 1]?.[rightIndex] ?? 0;
      const right = dp[leftIndex]?.[rightIndex + 1] ?? 0;
      const diagonal = dp[leftIndex + 1]?.[rightIndex + 1] ?? 0;
      row[rightIndex] = leftLine === rightLine ? diagonal + 1 : Math.max(down, right);
    }
  }

  const operations: Array<
    { type: "equal"; left: string; right: string } | { type: "remove"; left: string } | { type: "add"; right: string }
  > = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < leftLength && rightIndex < rightLength) {
    const leftLine = leftLines[leftIndex] ?? "";
    const rightLine = rightLines[rightIndex] ?? "";
    if (leftLine === rightLine) {
      operations.push({ type: "equal", left: leftLine, right: rightLine });
      leftIndex += 1;
      rightIndex += 1;
    } else if ((dp[leftIndex + 1]?.[rightIndex] ?? 0) >= (dp[leftIndex]?.[rightIndex + 1] ?? 0)) {
      operations.push({ type: "remove", left: leftLine });
      leftIndex += 1;
    } else {
      operations.push({ type: "add", right: rightLine });
      rightIndex += 1;
    }
  }

  while (leftIndex < leftLength) {
    operations.push({ type: "remove", left: leftLines[leftIndex] ?? "" });
    leftIndex += 1;
  }

  while (rightIndex < rightLength) {
    operations.push({ type: "add", right: rightLines[rightIndex] ?? "" });
    rightIndex += 1;
  }

  return operations;
}

function highlightChangedLine(left: string | undefined, right: string | undefined) {
  if (left == null) {
    return {
      left: [] as DiffSegment[],
      right: right ? [{ value: right, kind: "add" as const }] : [],
    };
  }

  if (right == null) {
    return {
      left: left ? [{ value: left, kind: "remove" as const }] : [],
      right: [] as DiffSegment[],
    };
  }

  let prefixLength = 0;
  while (prefixLength < left.length && prefixLength < right.length && left[prefixLength] === right[prefixLength]) {
    prefixLength += 1;
  }

  let leftSuffixIndex = left.length - 1;
  let rightSuffixIndex = right.length - 1;
  while (
    leftSuffixIndex >= prefixLength &&
    rightSuffixIndex >= prefixLength &&
    left[leftSuffixIndex] === right[rightSuffixIndex]
  ) {
    leftSuffixIndex -= 1;
    rightSuffixIndex -= 1;
  }

  const leftSegments: DiffSegment[] = [];
  const rightSegments: DiffSegment[] = [];
  const prefix = left.slice(0, prefixLength);
  const leftMiddle = left.slice(prefixLength, leftSuffixIndex + 1);
  const rightMiddle = right.slice(prefixLength, rightSuffixIndex + 1);
  const suffix = left.slice(leftSuffixIndex + 1);

  if (prefix) {
    leftSegments.push({ value: prefix, kind: "equal" });
    rightSegments.push({ value: prefix, kind: "equal" });
  }
  if (leftMiddle) {
    leftSegments.push({ value: leftMiddle, kind: "remove" });
  }
  if (rightMiddle) {
    rightSegments.push({ value: rightMiddle, kind: "add" });
  }
  if (suffix) {
    leftSegments.push({ value: suffix, kind: "equal" });
    rightSegments.push({ value: suffix, kind: "equal" });
  }

  return {
    left: leftSegments,
    right: rightSegments,
  };
}

function normalizeChapterText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}
