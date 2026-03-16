import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";

import {
  APP_SETTING_KEYS,
  normalizeChapterText,
  normalizeProvider,
  reconstructSourceTextFromChunks,
  type AdminBookSourcePayload,
  type AdminBookSummary,
  type AdminBootstrapPayload,
  type AdminTranslationDetail,
  type AdminTranslationSummary,
  type AdminTranslationValidationPayload,
  type AiProvider,
  type SourceChapterInput,
  type TranslationChapterDraft,
  type TranslationDraftArchive,
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

export default function AdminApp() {
  const [screen, setScreen] = useState<AdminScreen>("books");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [bootstrap, setBootstrap] = useState<AdminBootstrapPayload | null>(null);
  const [selectedBook, setSelectedBook] = useState<AdminBookSourcePayload | null>(null);
  const [translations, setTranslations] = useState<AdminTranslationSummary[]>([]);
  const [activeTranslation, setActiveTranslation] = useState<AdminTranslationDetail | null>(null);
  const [validation, setValidation] = useState<AdminTranslationValidationPayload | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);

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
  const [chapterEditor, setChapterEditor] = useState<ChapterEditorState | null>(null);

  const [editingBook, setEditingBook] = useState<AdminBookSummary | null>(null);
  const [editingBookTitle, setEditingBookTitle] = useState("");
  const [editingBookAuthor, setEditingBookAuthor] = useState("");
  const [editingBookLanguage, setEditingBookLanguage] = useState("");
  const [editingBookDescription, setEditingBookDescription] = useState("");

  const importTranslationInputRef = useRef<HTMLInputElement | null>(null);

  const currentWorkspaceChapter =
    activeTranslation?.chapters.find((chapter) => chapter.chapterId === selectedChapterId) ??
    activeTranslation?.chapters[0] ??
    null;
  const currentValidationChapter =
    validation?.chapters.find((chapter) => chapter.chapterId === currentWorkspaceChapter?.chapterId) ?? null;
  const validationPreviewChapter =
    activeTranslation?.chapters.find((chapter) => chapter.chapterId === selectedChapterId) ??
    activeTranslation?.chapters[0] ??
    null;
  const selectedBookStatus = useMemo(
    () =>
      selectedBook?.book.translations.some((translation) => translation.status === "published") ? "published" : "draft",
    [selectedBook],
  );
  const translationMetadataIsDirty = useMemo(() => {
    if (!activeTranslation) {
      return false;
    }

    return (
      JSON.stringify(buildTranslationMetadataSnapshot(activeTranslation)) !==
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
    contextAfterChapterCount,
    contextBeforeChapterCount,
    translationDescription,
    translationModel,
    translationPrompt,
    translationProvider,
    translationSlug,
    translationThinkingLevel,
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
  const sourceReconstructionMatches = useMemo(() => {
    if (!currentWorkspaceChapter || !chapterEditor) {
      return true;
    }

    return (
      normalizeChapterText(currentWorkspaceChapter.sourceText) ===
      normalizeChapterText(reconstructSourceTextFromChunks(chapterEditor.chunks))
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

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      try {
        const payload = await api.getAdminBootstrap();
        if (isCancelled) {
          return;
        }

        setBootstrap(payload);
        setSettingsOpenRouterApiKey(payload.settings[APP_SETTING_KEYS.OPENROUTER_API_KEY] ?? "");
        setSettingsGoogleApiKey(payload.settings[APP_SETTING_KEYS.GOOGLE_API_KEY] ?? "");

        const provider = normalizeProvider(payload.settings[APP_SETTING_KEYS.DEFAULT_PROVIDER]);
        const model = payload.settings[APP_SETTING_KEYS.DEFAULT_MODEL] ?? DEFAULT_MODEL;
        const prompt = payload.settings[APP_SETTING_KEYS.DEFAULT_PROMPT] ?? "";

        setSettingsProvider(provider);
        setSettingsModel(model);
        setSettingsPrompt(prompt);
        setTranslationProvider(provider);
        setTranslationModel(model);
        setTranslationPrompt(prompt);
      } catch (loadError) {
        if (!isCancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load admin data.");
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeTranslation) {
      setSelectedChapterId(null);
      return;
    }

    if (!activeTranslation.chapters.some((chapter) => chapter.chapterId === selectedChapterId)) {
      setSelectedChapterId(activeTranslation.chapters[0]?.chapterId ?? null);
    }
  }, [activeTranslation, selectedChapterId]);

  useEffect(() => {
    const nextEditor = currentWorkspaceChapter ? buildChapterEditorState(currentWorkspaceChapter) : null;
    setChapterEditor(nextEditor);
  }, [currentWorkspaceChapter]);

  function applyBootstrapSettings(payload: AdminBootstrapPayload, seedTranslationDefaults: boolean) {
    setBootstrap(payload);
    setSettingsOpenRouterApiKey(payload.settings[APP_SETTING_KEYS.OPENROUTER_API_KEY] ?? "");
    setSettingsGoogleApiKey(payload.settings[APP_SETTING_KEYS.GOOGLE_API_KEY] ?? "");

    const provider = normalizeProvider(payload.settings[APP_SETTING_KEYS.DEFAULT_PROVIDER]);
    const model = payload.settings[APP_SETTING_KEYS.DEFAULT_MODEL] ?? DEFAULT_MODEL;
    const prompt = payload.settings[APP_SETTING_KEYS.DEFAULT_PROMPT] ?? "";

    setSettingsProvider(provider);
    setSettingsModel(model);
    setSettingsPrompt(prompt);

    if (seedTranslationDefaults) {
      setTranslationProvider(provider);
      setTranslationModel(model);
      setTranslationPrompt(prompt);
    }
  }

  async function refreshBootstrap(seedTranslationDefaults = false) {
    const payload = await api.getAdminBootstrap();
    applyBootstrapSettings(payload, seedTranslationDefaults);
  }

  async function refreshBookContext(bookSlugValue: string) {
    const [book, translationResult] = await Promise.all([
      api.getAdminBook(bookSlugValue),
      api.listAdminTranslations(bookSlugValue),
    ]);

    setSelectedBook(book);
    setTranslations(translationResult.translations);
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
  }

  function goToBooks() {
    setScreen("books");
    setSelectedBook(null);
    setTranslations([]);
    setActiveTranslation(null);
    setValidation(null);
    setSelectedChapterId(null);
    resetTranslationForm();
  }

  function goToTranslations() {
    setScreen("translations");
    setActiveTranslation(null);
    setValidation(null);
    setSelectedChapterId(null);
    resetTranslationForm();
  }

  async function openBook(bookSlugValue: string) {
    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      await refreshBookContext(bookSlugValue);
      setActiveTranslation(null);
      setValidation(null);
      setSelectedChapterId(null);
      resetTranslationForm();
      setScreen("translations");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load book.");
    } finally {
      setIsBusy(false);
    }
  }

  function openBookMetadataEditor(book: AdminBookSummary) {
    setEditingBook(book);
    setEditingBookTitle(book.title);
    setEditingBookAuthor(book.author ?? "");
    setEditingBookLanguage(book.originalLanguage ?? "");
    setEditingBookDescription(book.description ?? "");
  }

  function closeBookMetadataEditor() {
    setEditingBook(null);
    setEditingBookTitle("");
    setEditingBookAuthor("");
    setEditingBookLanguage("");
    setEditingBookDescription("");
  }

  async function saveBookMetadata() {
    if (!editingBook) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const updated = await api.updateAdminBook(editingBook.slug, {
        title: editingBookTitle,
        author: editingBookAuthor,
        originalLanguage: editingBookLanguage,
        description: editingBookDescription,
      });

      await refreshBootstrap();
      if (selectedBook?.book.slug === editingBook.slug) {
        await refreshBookContext(editingBook.slug);
        setSelectedBook(updated);
      }

      closeBookMetadataEditor();
      setNotice(`Updated '${updated.book.title}'.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update book metadata.");
    } finally {
      setIsBusy(false);
    }
  }

  async function deleteBookFromList(book: AdminBookSummary) {
    const firstConfirm = window.confirm(
      `Delete '${book.title}'? This will permanently delete the book, its translations, and related files.`,
    );
    if (!firstConfirm) {
      return;
    }

    const secondConfirm = window.confirm(`Delete '${book.title}' for real? This cannot be undone.`);
    if (!secondConfirm) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      await api.deleteAdminBook(book.slug);
      await refreshBootstrap();

      if (selectedBook?.book.slug === book.slug) {
        goToBooks();
      }

      setNotice(`Deleted '${book.title}'.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete book.");
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
        [APP_SETTING_KEYS.OPENROUTER_API_KEY]: settingsOpenRouterApiKey,
        [APP_SETTING_KEYS.GOOGLE_API_KEY]: settingsGoogleApiKey,
        [APP_SETTING_KEYS.DEFAULT_PROVIDER]: settingsProvider,
        [APP_SETTING_KEYS.DEFAULT_MODEL]: settingsModel,
        [APP_SETTING_KEYS.DEFAULT_PROMPT]: settingsPrompt,
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
        chapters: stagedChapters.map(
          (chapter, index) =>
            ({
              position: index + 1,
              title: chapter.title,
              slug: chapter.slug,
              sourceText: chapter.sourceText,
            }) satisfies SourceChapterInput,
        ),
      });

      await refreshBootstrap();
      setSelectedBook(created);
      setTranslations([]);
      setActiveTranslation(null);
      setValidation(null);
      setSelectedChapterId(null);
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

  function hydrateActiveTranslation(translation: AdminTranslationDetail, preferredChapterId?: string | null) {
    setActiveTranslation(translation);
    setTranslationTitle(translation.name);
    setTranslationSlug(translation.slug);
    setTranslationDescription(translation.description ?? "");
    setTranslationProvider(translation.provider);
    setTranslationModel(translation.model);
    setTranslationThinkingLevel(translation.thinkingLevel ?? "");
    setTranslationPrompt(translation.prompt);
    setContextBeforeChapterCount(String(translation.contextBeforeChapterCount));
    setContextAfterChapterCount(String(translation.contextAfterChapterCount));

    const nextChapterId =
      (preferredChapterId && translation.chapters.some((chapter) => chapter.chapterId === preferredChapterId)
        ? preferredChapterId
        : null) ??
      translation.chapters[0]?.chapterId ??
      null;

    setSelectedChapterId(nextChapterId);
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

      await refreshBookContext(selectedBook.book.slug);
      await refreshBootstrap();
      hydrateActiveTranslation(translation);
      setValidation(null);
      setScreen("workspace");
      setNotice(`Created translation '${translation.name}'.`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create translation.");
    } finally {
      setIsBusy(false);
    }
  }

  function promptTranslationImport() {
    importTranslationInputRef.current?.click();
  }

  async function importTranslationFromFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!selectedBook || !file) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const rawText = await file.text();
      const archive = JSON.parse(rawText) as TranslationDraftArchive | unknown;
      const translation = await api.importAdminTranslation(selectedBook.book.slug, { archive });

      await refreshBookContext(selectedBook.book.slug);
      await refreshBootstrap();
      hydrateActiveTranslation(translation);
      setValidation(null);
      setScreen("workspace");
      setNotice(`Imported translation '${translation.name}'.`);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Failed to import translation.");
    } finally {
      event.target.value = "";
      setIsBusy(false);
    }
  }

  async function deleteTranslationFromList(translation: AdminTranslationSummary) {
    const firstConfirm = window.confirm(
      `Delete translation '${translation.name}'? This will permanently remove it and delete its published files.`,
    );
    if (!firstConfirm) {
      return;
    }

    const secondConfirm = window.confirm(`Delete translation '${translation.name}' for real? This cannot be undone.`);
    if (!secondConfirm) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      await api.deleteAdminTranslation(translation.id);

      if (selectedBook) {
        await refreshBookContext(selectedBook.book.slug);
      }
      await refreshBootstrap();

      if (activeTranslation?.id === translation.id) {
        goToTranslations();
      }

      setNotice(`Deleted translation '${translation.name}'.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete translation.");
    } finally {
      setIsBusy(false);
    }
  }

  async function unpublishTranslationFromList(translation: AdminTranslationSummary) {
    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const updated = await api.unpublishAdminTranslation(translation.id);

      if (selectedBook) {
        await refreshBookContext(selectedBook.book.slug);
      }
      await refreshBootstrap();

      if (activeTranslation?.id === translation.id) {
        hydrateActiveTranslation(updated, selectedChapterId);
      }

      setNotice(`Unpublished '${translation.name}'.`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to unpublish translation.");
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

  async function saveTranslationSettings(options?: { refreshState?: boolean }) {
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
      contextBeforeChapterCount: Number(contextBeforeChapterCount || 0),
      contextAfterChapterCount: Number(contextAfterChapterCount || 0),
    });

    hydrateActiveTranslation(updated, currentWorkspaceChapter?.chapterId ?? selectedChapterId);

    if ((options?.refreshState ?? true) && selectedBook) {
      await refreshBookContext(selectedBook.book.slug);
      await refreshBootstrap();
    }

    return updated;
  }

  async function generateCurrentChapter() {
    if (!activeTranslation || !currentWorkspaceChapter) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      await saveTranslationSettings({ refreshState: false });
      const updated = await api.generateAdminTranslationChapter(
        activeTranslation.id,
        currentWorkspaceChapter.chapterId,
      );

      if (selectedBook) {
        await refreshBookContext(selectedBook.book.slug);
      }
      await refreshBootstrap();
      hydrateActiveTranslation(updated, currentWorkspaceChapter.chapterId);
      setValidation(null);
      setNotice(`Generated '${currentWorkspaceChapter.title}'.`);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Failed to generate chapter.");
    } finally {
      setIsBusy(false);
    }
  }

  async function saveCurrentChapter() {
    if (!activeTranslation || !currentWorkspaceChapter || !chapterEditor) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const updated = await api.saveAdminTranslationChapter(
        activeTranslation.id,
        currentWorkspaceChapter.chapterId,
        JSON.stringify(serializeEditorState(chapterEditor), null, 2),
      );

      if (selectedBook) {
        await refreshBookContext(selectedBook.book.slug);
      }
      await refreshBootstrap();
      hydrateActiveTranslation(updated, currentWorkspaceChapter.chapterId);
      setValidation(null);
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
      await saveTranslationSettings({ refreshState: false });
      const payload = await api.validateAdminTranslation(activeTranslation.id);
      setValidation(payload);

      const currentChapterExists = payload.chapters.some(
        (chapter) => chapter.chapterId === currentWorkspaceChapter?.chapterId,
      );
      if (!currentChapterExists) {
        setSelectedChapterId(payload.chapters[0]?.chapterId ?? null);
      }

      if (options?.openResults ?? true) {
        setScreen("validate");
      }
      setNotice(payload.isValid ? "Validation passed." : "Validation found blocking issues.");
    } catch (validateError) {
      setError(validateError instanceof Error ? validateError.message : "Failed to validate translation.");
    } finally {
      setIsBusy(false);
    }
  }

  async function publishActiveTranslation() {
    if (!activeTranslation) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      await saveTranslationSettings({ refreshState: false });
      const updated = await api.publishAdminTranslation(activeTranslation.id);

      if (selectedBook) {
        await refreshBookContext(selectedBook.book.slug);
      }
      await refreshBootstrap();
      hydrateActiveTranslation(updated, currentWorkspaceChapter?.chapterId ?? selectedChapterId);
      setValidation(null);
      setNotice("Translation published.");
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "Failed to publish translation.");
    } finally {
      setIsBusy(false);
    }
  }

  async function unpublishActiveTranslation() {
    if (!activeTranslation) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const updated = await api.unpublishAdminTranslation(activeTranslation.id);

      if (selectedBook) {
        await refreshBookContext(selectedBook.book.slug);
      }
      await refreshBootstrap();
      hydrateActiveTranslation(updated, currentWorkspaceChapter?.chapterId ?? selectedChapterId);
      setValidation(null);
      setNotice("Translation unpublished.");
    } catch (unpublishError) {
      setError(unpublishError instanceof Error ? unpublishError.message : "Failed to unpublish translation.");
    } finally {
      setIsBusy(false);
    }
  }

  function exportTranslationJson() {
    if (!activeTranslation) {
      return;
    }

    const archive = buildTranslationArchive(activeTranslation);
    const blob = new Blob([JSON.stringify(archive, null, 2)], {
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
    if (!issue?.chapterId) {
      return;
    }

    setSelectedChapterId(issue.chapterId);
    setScreen("workspace");
  }

  function updateChapterEditor(updater: (current: ChapterEditorState) => ChapterEditorState) {
    setChapterEditor((current) => (current ? updater(current) : current));
  }

  const breadcrumbs = buildBreadcrumbs({
    screen,
    selectedBookTitle: selectedBook?.book.title ?? null,
    activeTranslationName: activeTranslation?.name ?? null,
    onBooks: goToBooks,
    onCreateBook: () => setScreen("create-book"),
    onTranslations: selectedBook ? goToTranslations : null,
    onWorkspace: activeTranslation ? () => setScreen("workspace") : null,
  });

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="flex min-h-screen w-full flex-col gap-8 px-6 py-8 lg:px-10">
        <header className="rounded-[24px] border border-border/70 bg-white/85 px-5 py-4 shadow-panel backdrop-blur">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={goToBooks}
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
                  <div key={book.id} className="rounded-[24px] border border-border/70 bg-paper/80 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                        {getBookPublicationStatus(book.publishedTranslationCount)}
                      </p>
                      <span className="text-xs text-ink/55">{formatTimestamp(book.latestActivityAt)}</span>
                    </div>
                    <h2 className="mt-3 font-display text-3xl text-ink">{book.title}</h2>
                    <p className="mt-2 text-sm text-ink/65">{book.author || "Unknown author"}</p>
                    <p className="mt-4 text-sm leading-7 text-ink/75">{book.description || "No description yet."}</p>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-ink/70">
                      <Metric label="Chapters" value={String(book.chapterCount)} />
                      <Metric label="Translations" value={String(book.translationCount)} />
                      <Metric label="Published" value={String(book.publishedTranslationCount)} />
                      <Metric label="Language" value={book.originalLanguage || "Unknown"} />
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <ActionButton label="Open" onClick={() => void openBook(book.slug)} tone="accent" />
                      <ActionButton label="Edit" onClick={() => openBookMetadataEditor(book)} />
                      <button
                        type="button"
                        onClick={() => void deleteBookFromList(book)}
                        className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Create New">
              <p className="text-base leading-7 text-ink/70">
                Paste a source text, split it into chapters, and keep the stored model as plain books, chapters, and
                translations.
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
                <ActionButton label="Back To Books" onClick={goToBooks} />
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
                      Generate an auto-split preview, then adjust the staged chapters before creating the book.
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
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{selectedBookStatus}</p>
                <h2 className="font-display text-4xl text-ink">{selectedBook.book.title}</h2>
                <p className="text-sm text-ink/65">{selectedBook.book.author || "Unknown author"}</p>
                <p className="text-sm leading-7 text-ink/75">
                  {selectedBook.book.description || "No description yet."}
                </p>
                <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border/70 bg-paper/75 p-4 text-sm text-ink/70">
                  <Metric label="Chapters" value={String(selectedBook.chapters.length)} />
                  <Metric label="Translations" value={String(translations.length)} />
                  <Metric
                    label="Published"
                    value={String(translations.filter((translation) => translation.status === "published").length)}
                  />
                  <Metric label="Language" value={selectedBook.book.originalLanguage || "Unknown"} />
                </div>
                <ActionButton label="Back To Books" onClick={goToBooks} />
              </div>
            </Panel>

            <div className="grid gap-6">
              <Panel title="Translations">
                <input
                  ref={importTranslationInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(event) => void importTranslationFromFile(event)}
                />
                <div className="mb-4 flex flex-wrap gap-3">
                  <ActionButton
                    label={isBusy ? "Importing..." : "Import Translation JSON"}
                    onClick={promptTranslationImport}
                    disabled={isBusy}
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {translations.map((translation) => (
                    <div key={translation.id} className="rounded-[24px] border border-border/70 bg-paper/80 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <StatusPill status={translation.status} />
                        <span className="text-xs text-ink/55">{formatTimestamp(translation.latestActivityAt)}</span>
                      </div>
                      <h3 className="mt-3 font-display text-3xl text-ink">{translation.name}</h3>
                      <p className="mt-2 text-sm leading-7 text-ink/70">
                        {translation.description || "No description yet."}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink/65">
                        <span className="rounded-full border border-border/70 bg-white/75 px-3 py-1">
                          {formatProviderLabel(translation.provider)} · {translation.model}
                        </span>
                        <span className="rounded-full border border-border/70 bg-white/75 px-3 py-1">
                          {formatThinkingSummary(translation)}
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-ink/70">
                        <Metric label="Saved" value={`${translation.savedChapterCount}/${translation.chapterCount}`} />
                        <Metric label="Draft" value={String(translation.draftChapterCount)} />
                        <Metric label="Errors" value={String(translation.errorChapterCount)} />
                        <Metric label="Published" value={translation.status === "published" ? "Yes" : "No"} />
                      </div>
                      <div className="mt-5 flex flex-wrap gap-2">
                        <ActionButton label="Open" onClick={() => void openTranslation(translation.id)} tone="accent" />
                        {translation.status === "published" ? (
                          <ActionButton
                            label="Unpublish"
                            onClick={() => void unpublishTranslationFromList(translation)}
                          />
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void deleteTranslationFromList(translation)}
                          className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                  {translations.length === 0 ? (
                    <p className="text-base leading-7 text-ink/70">No translations yet for this book.</p>
                  ) : null}
                </div>
              </Panel>

              <Panel title="Create Translation">
                <div className="grid gap-4">
                  <InputField label="Translation Name" value={translationTitle} onChange={setTranslationTitle} />
                  <InputField label="Description" value={translationDescription} onChange={setTranslationDescription} />
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
                  <TextareaField label="Prompt" value={translationPrompt} onChange={setTranslationPrompt} rows={10} />
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <ActionButton
                    label={isBusy ? "Creating..." : "Create Translation"}
                    onClick={createTranslation}
                    tone="accent"
                    disabled={
                      isBusy || !translationTitle.trim() || !translationModel.trim() || !translationPrompt.trim()
                    }
                  />
                </div>
              </Panel>
            </div>
          </section>
        ) : null}

        {screen === "workspace" && activeTranslation ? (
          <section className="grid gap-6 xl:grid-cols-[320px_1fr]">
            <Panel title="Translation">
              <div className="rounded-2xl border border-border/60 bg-paper/70 p-4 text-sm text-ink/70">
                <StatusPill status={activeTranslation.status} />
                <h3 className="mt-3 font-display text-3xl text-ink">{activeTranslation.name}</h3>
                <p className="mt-2 leading-7">{activeTranslation.description || "No description yet."}</p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Metric
                    label="Saved"
                    value={`${activeTranslation.savedChapterCount}/${activeTranslation.chapterCount}`}
                  />
                  <Metric label="Draft" value={String(activeTranslation.draftChapterCount)} />
                  <Metric label="Errors" value={String(activeTranslation.errorChapterCount)} />
                  <Metric label="Provider" value={formatProviderLabel(activeTranslation.provider)} />
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {activeTranslation.chapters.map((chapter) => {
                  const issueCount =
                    validation?.chapters.find((validationChapter) => validationChapter.chapterId === chapter.chapterId)
                      ?.issues.length ?? 0;
                  return (
                    <button
                      key={chapter.chapterId}
                      type="button"
                      onClick={() => setSelectedChapterId(chapter.chapterId)}
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                        selectedChapterId === chapter.chapterId
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
                <ActionButton label="Back To Translations" onClick={goToTranslations} />
                <ActionButton
                  label={isBusy ? "Validating..." : "Validate Translation"}
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
                          ? "Save Metadata"
                          : "Metadata Saved"
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
                  <Panel title={`Source: ${currentWorkspaceChapter.title}`}>
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-border/60 bg-paper/55 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Source Text</p>
                        <p className="mt-3 whitespace-pre-wrap text-base leading-7 text-ink/80">
                          {currentWorkspaceChapter.sourceText}
                        </p>
                      </div>

                      <div
                        className={`rounded-2xl border p-4 text-sm leading-6 ${
                          sourceReconstructionMatches
                            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                            : "border-amber-200 bg-amber-50 text-amber-950"
                        }`}
                      >
                        {sourceReconstructionMatches
                          ? "Current chunks reconstruct the source text exactly."
                          : "Current chunks do not reconstruct the source text exactly. Fix the chunk boundaries before publishing."}
                      </div>

                      {currentValidationChapter?.issues.length ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
                          Last validation run found {currentValidationChapter.issues.length} issue(s) on this chapter.
                        </div>
                      ) : null}

                      {currentWorkspaceChapter.errorMessage ? (
                        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900">
                          {currentWorkspaceChapter.errorMessage}
                        </div>
                      ) : null}
                    </div>
                  </Panel>

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
                    <div className="mt-6 flex justify-end">
                      <ActionButton
                        label={
                          isBusy && chapterIsDirty ? "Saving..." : chapterIsDirty ? "Save Chapter" : "Chapter Saved"
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
                {validation.isValid ? "Ready to publish" : "Blocking issues found"}
              </p>
              <p className="mt-3 text-sm leading-6 text-ink/70">
                Warnings are informational. Errors must be fixed before the backend will publish this translation.
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
                  label={isBusy ? "Refreshing..." : "Re-Validate"}
                  onClick={() => void validateCurrentTranslation({ openResults: true })}
                  tone="accent"
                  disabled={isBusy}
                />
                {activeTranslation.status === "published" ? (
                  <ActionButton
                    label={isBusy ? "Unpublishing..." : "Unpublish"}
                    onClick={() => void unpublishActiveTranslation()}
                    disabled={isBusy}
                  />
                ) : (
                  <ActionButton
                    label={isBusy ? "Publishing..." : "Publish Translation"}
                    onClick={() => void publishActiveTranslation()}
                    disabled={isBusy || !validation.isValid}
                  />
                )}
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
                  {validation.chapters.map((chapter) => (
                    <button
                      key={chapter.chapterId}
                      type="button"
                      onClick={() => setSelectedChapterId(chapter.chapterId)}
                      className={`rounded-2xl border px-4 py-3 text-left transition ${
                        selectedChapterId === chapter.chapterId
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
                        {chapter.issues.length > 0 ? `${chapter.issues.length} issue(s)` : "No issues"}
                      </p>
                    </button>
                  ))}
                </div>
              </Panel>

              <Panel title="Side-By-Side Preview">
                <ChapterSideBySidePreview chapter={validationPreviewChapter} />
              </Panel>
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

      {editingBook ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 px-4 py-6">
          <div className="w-full max-w-2xl rounded-[32px] border border-border/70 bg-white p-6 shadow-panel">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-display text-4xl text-ink">Edit Book</h2>
              <button
                type="button"
                onClick={closeBookMetadataEditor}
                className="rounded-full border border-border/70 px-4 py-2 text-sm font-semibold text-ink transition hover:border-accent/50"
              >
                Close
              </button>
            </div>
            <div className="mt-6 grid gap-4">
              <InputField label="Title" value={editingBookTitle} onChange={setEditingBookTitle} />
              <InputField label="Author" value={editingBookAuthor} onChange={setEditingBookAuthor} />
              <InputField label="Original Language" value={editingBookLanguage} onChange={setEditingBookLanguage} />
              <TextareaField
                label="Description"
                value={editingBookDescription}
                onChange={setEditingBookDescription}
                rows={6}
              />
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <ActionButton label="Cancel" onClick={closeBookMetadataEditor} disabled={isBusy} />
              <ActionButton
                label={isBusy ? "Saving..." : "Save Metadata"}
                onClick={() => void saveBookMetadata()}
                tone="accent"
                disabled={isBusy || !editingBookTitle.trim()}
              />
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
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
      : status === "published"
        ? "bg-sky-100 text-sky-800"
        : status === "draft"
          ? "bg-amber-100 text-amber-800"
          : status === "error"
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
      <div className="mt-3 space-y-3">
        {chunks.map((chunk, index) => (
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
        ))}
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

function ChapterSideBySidePreview({ chapter }: { chapter: TranslationChapterDraft | null }) {
  if (!chapter?.content || chapter.content.chunks.length === 0) {
    return <p className="text-base leading-7 text-ink/70">No translated content saved for this chapter yet.</p>;
  }

  return (
    <div className="divide-y divide-border/35">
      <div className="grid grid-cols-2 gap-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-accent md:gap-8">
        <div>Source</div>
        <div>Translation</div>
      </div>
      {chapter.content.chunks.map((chunk) => (
        <div key={chunk.id} className="grid grid-cols-2 gap-4 py-4 md:gap-8">
          <div>
            <p className="whitespace-pre-wrap text-lg leading-8 text-ink/80">{chunk.originalText}</p>
          </div>
          <div>
            <p className="whitespace-pre-wrap text-lg leading-8 text-ink/80">{chunk.translatedText}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function buildChapterEditorState(chapter: TranslationChapterDraft): ChapterEditorState {
  if (chapter.rawResponse?.trim()) {
    try {
      return parseEditorStateFromRaw(chapter.rawResponse);
    } catch {
      // Fall back to structured content below.
    }
  }

  return {
    chapterTitle: chapter.title,
    notes: chapter.notes ?? "",
    chunks: (
      chapter.content?.chunks ?? [
        {
          originalText: chapter.sourceText,
          translatedText: "",
          type: chapter.sourceText.includes("\n") ? "verse" : "prose",
        },
      ]
    ).map((chunk) => ({
      originalText: chunk.originalText,
      translatedText: chunk.translatedText,
      type: chunk.type,
    })),
  };
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
    originalText: chunk.originalText ?? "",
    translatedText: chunk.translatedText ?? "",
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
  translation:
    | {
        thinkingLevel: string | null;
      }
    | null
    | undefined,
): string {
  if (!translation?.thinkingLevel) {
    return "Thinking default";
  }

  if (translation.thinkingLevel === "none") {
    return "Thinking off";
  }

  return `Thinking ${translation.thinkingLevel}`;
}

function formatProviderLabel(provider: AiProvider): string {
  return provider === "openrouter" ? "OpenRouter" : "Gemini SDK";
}

function buildTranslationMetadataSnapshot(activeTranslation: AdminTranslationDetail) {
  return {
    name: activeTranslation.name.trim(),
    slug: activeTranslation.slug.trim(),
    description: (activeTranslation.description ?? "").trim(),
    provider: activeTranslation.provider,
    model: activeTranslation.model.trim(),
    thinkingLevel: activeTranslation.thinkingLevel ?? null,
    prompt: activeTranslation.prompt,
    contextBeforeChapterCount: activeTranslation.contextBeforeChapterCount,
    contextAfterChapterCount: activeTranslation.contextAfterChapterCount,
  };
}

function buildTranslationArchive(activeTranslation: AdminTranslationDetail): TranslationDraftArchive {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    translation: {
      name: activeTranslation.name,
      slug: activeTranslation.slug,
      description: activeTranslation.description,
      provider: activeTranslation.provider,
      model: activeTranslation.model,
      thinkingLevel: activeTranslation.thinkingLevel,
      prompt: activeTranslation.prompt,
      contextBeforeChapterCount: activeTranslation.contextBeforeChapterCount,
      contextAfterChapterCount: activeTranslation.contextAfterChapterCount,
    },
    chapters: activeTranslation.chapters.map((chapter) => ({
      chapterSlug: chapter.slug,
      position: chapter.position,
      title: chapter.title,
      status: chapter.status,
      rawResponse: chapter.rawResponse,
      content: chapter.content,
      notes: chapter.notes,
    })),
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

function formatTimestamp(value: string | null) {
  if (!value) {
    return "No activity";
  }

  return new Date(value).toLocaleDateString();
}

function getBookPublicationStatus(publishedTranslationCount: number) {
  return publishedTranslationCount > 0 ? "published" : "draft";
}
