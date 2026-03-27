import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { matchPath, useLocation, useNavigate } from "react-router-dom";

import {
  APP_SETTING_KEYS,
  type AdminBookSourcePayload,
  type AdminBookSummary,
  type AdminBootstrapPayload,
  type AdminTranslationDetail,
  type AdminTranslationSummary,
  type AdminTranslationValidationPayload,
  type SourceChapterInput,
  type TranslationDraftArchive,
} from "@ancient-epics/shared";

import { StatusPanel } from "./components/StatusPanel";
import { AppVersionFooter } from "./components/AppVersionFooter";
import { BooksScreen } from "./admin/BooksScreen";
import { CreateBookScreen } from "./admin/CreateBookScreen";
import { EditBookDialog } from "./admin/EditBookDialog";
import {
  buildEditBookFormValues,
  buildEmptyCreateBookFormValues,
  buildSettingsFormValues,
  buildTranslationDefaultValues,
  buildTranslationFormValues,
  type CreateBookFormValues,
  type EditBookFormValues,
  type SettingsFormValues,
  type TranslationFormValues,
} from "./admin/forms";
import { SettingsDialog } from "./admin/SettingsDialog";
import { TranslationsScreen } from "./admin/TranslationsScreen";
import { ValidationScreen } from "./admin/ValidationScreen";
import { WorkspaceScreen } from "./admin/WorkspaceScreen";
import { Panel } from "./admin/ui";
import {
  buildChapterEditorState,
  buildTranslationArchive,
  getSourceReconstructionMatches,
  normalizeThinkingLevelValue,
  serializeEditorState,
  type ChapterEditorState,
} from "./admin/utils";
import type { BreadcrumbItem } from "./components/BreadcrumbTrail";
import { api } from "./lib/api";
import { splitSourceTextIntoChapters, type SplitChapterInput } from "./lib/chapter-splitting";

type AdminRoute =
  | { screen: "books"; canonicalPath: string }
  | { screen: "create-book"; canonicalPath: string }
  | { screen: "translations"; bookSlug: string; canonicalPath: string }
  | { screen: "workspace"; translationId: string; canonicalPath: string }
  | { screen: "validate"; translationId: string; canonicalPath: string };

function buildAdminBooksPath() {
  return "/admin/books";
}

function buildAdminCreateBookPath() {
  return "/admin/books/new";
}

function buildAdminBookPath(bookSlug: string) {
  return `/admin/books/${bookSlug}`;
}

function buildWorkspacePath(translationId: string) {
  return `/admin/translations/${translationId}/workspace`;
}

function buildValidationPath(translationId: string) {
  return `/admin/translations/${translationId}/validate`;
}

function getAdminRoute(pathname: string): AdminRoute {
  const validateMatch = matchPath("/admin/translations/:translationId/validate", pathname);
  if (validateMatch?.params.translationId) {
    return {
      screen: "validate",
      translationId: validateMatch.params.translationId,
      canonicalPath: buildValidationPath(validateMatch.params.translationId),
    };
  }

  const workspaceMatch = matchPath("/admin/translations/:translationId/workspace", pathname);
  if (workspaceMatch?.params.translationId) {
    return {
      screen: "workspace",
      translationId: workspaceMatch.params.translationId,
      canonicalPath: buildWorkspacePath(workspaceMatch.params.translationId),
    };
  }

  const bookMatch = matchPath("/admin/books/:bookSlug", pathname);
  if (bookMatch?.params.bookSlug && bookMatch.params.bookSlug !== "new") {
    return {
      screen: "translations",
      bookSlug: bookMatch.params.bookSlug,
      canonicalPath: buildAdminBookPath(bookMatch.params.bookSlug),
    };
  }

  if (pathname === "/admin/books/new") {
    return {
      screen: "create-book",
      canonicalPath: buildAdminCreateBookPath(),
    };
  }

  return {
    screen: "books",
    canonicalPath: buildAdminBooksPath(),
  };
}

export default function AdminApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const route = useMemo(() => getAdminRoute(location.pathname), [location.pathname]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bootstrap, setBootstrap] = useState<AdminBootstrapPayload | null>(null);
  const [selectedBook, setSelectedBook] = useState<AdminBookSourcePayload | null>(null);
  const [translations, setTranslations] = useState<AdminTranslationSummary[]>([]);
  const [activeTranslation, setActiveTranslation] = useState<AdminTranslationDetail | null>(null);
  const [validation, setValidation] = useState<AdminTranslationValidationPayload | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [chapterEditor, setChapterEditor] = useState<ChapterEditorState | null>(null);
  const [editingBook, setEditingBook] = useState<AdminBookSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const importTranslationInputRef = useRef<HTMLInputElement | null>(null);
  const activeTranslationRef = useRef<AdminTranslationDetail | null>(null);
  const selectedChapterIdRef = useRef<string | null>(null);

  const settingsForm = useForm<SettingsFormValues>({
    defaultValues: buildSettingsFormValues(null),
  });
  const bookForm = useForm<CreateBookFormValues>({
    defaultValues: buildEmptyCreateBookFormValues(),
  });
  const translationForm = useForm<TranslationFormValues>({
    defaultValues: buildTranslationDefaultValues(null),
  });
  const editBookForm = useForm<EditBookFormValues>({
    defaultValues: {
      title: "",
      author: "",
      originalLanguage: "",
      description: "",
    },
  });

  const { fields: stagedChapters, replace: replaceStagedChapters } = useFieldArray({
    control: bookForm.control,
    name: "stagedChapters",
  });

  const bookRawText = bookForm.watch("rawText");
  const splitMode = bookForm.watch("splitMode");
  const headingPattern = bookForm.watch("headingPattern");
  const delimiter = bookForm.watch("delimiter");

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
  const translationMetadataIsDirty = Boolean(activeTranslation) && translationForm.formState.isDirty;
  const chapterIsDirty = useMemo(() => {
    if (!currentWorkspaceChapter || !chapterEditor) {
      return false;
    }

    return (
      JSON.stringify(serializeEditorState(buildChapterEditorState(currentWorkspaceChapter))) !==
      JSON.stringify(serializeEditorState(chapterEditor))
    );
  }, [chapterEditor, currentWorkspaceChapter]);
  const sourceReconstructionMatches = useMemo(
    () => getSourceReconstructionMatches(currentWorkspaceChapter, chapterEditor),
    [chapterEditor, currentWorkspaceChapter],
  );
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
    if (location.pathname !== route.canonicalPath) {
      navigate(route.canonicalPath, { replace: true });
    }
  }, [location.pathname, navigate, route.canonicalPath]);

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
    setChapterEditor(currentWorkspaceChapter ? buildChapterEditorState(currentWorkspaceChapter) : null);
  }, [currentWorkspaceChapter]);

  useEffect(() => {
    activeTranslationRef.current = activeTranslation;
    selectedChapterIdRef.current = selectedChapterId;
  }, [activeTranslation, selectedChapterId]);

  useEffect(() => {
    if (!bootstrap) {
      return;
    }

    if (
      route.screen === "books" ||
      route.screen === "create-book" ||
      (route.screen === "translations" && !activeTranslation)
    ) {
      translationForm.reset(buildTranslationDefaultValues(bootstrap));
    }
  }, [activeTranslation, bootstrap, route.screen, translationForm]);

  const applyBootstrapSettings = useCallback(
    (payload: AdminBootstrapPayload, seedTranslationDefaults: boolean) => {
      setBootstrap(payload);
      settingsForm.reset(buildSettingsFormValues(payload));

      if (seedTranslationDefaults) {
        translationForm.reset(buildTranslationDefaultValues(payload));
      }
    },
    [settingsForm, translationForm],
  );

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
    bookForm.reset(buildEmptyCreateBookFormValues());
  }

  function resetTranslationForm() {
    translationForm.reset(buildTranslationDefaultValues(bootstrap));
  }

  function goToBooks() {
    navigate(buildAdminBooksPath());
  }

  function goToCreateBook() {
    navigate(buildAdminCreateBookPath());
  }

  function goToTranslations() {
    if (selectedBook) {
      navigate(buildAdminBookPath(selectedBook.book.slug));
    } else {
      navigate(buildAdminBooksPath());
    }
  }

  function openBook(bookSlugValue: string) {
    navigate(buildAdminBookPath(bookSlugValue));
  }

  function openBookMetadataEditor(book: AdminBookSummary) {
    setEditingBook(book);
    editBookForm.reset(buildEditBookFormValues(book));
  }

  function closeBookMetadataEditor() {
    setEditingBook(null);
    editBookForm.reset({
      title: "",
      author: "",
      originalLanguage: "",
      description: "",
    });
  }

  async function saveBookMetadata() {
    if (!editingBook) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const values = editBookForm.getValues();
      const updated = await api.updateAdminBook(editingBook.slug, {
        title: values.title,
        author: values.author,
        originalLanguage: values.originalLanguage,
        description: values.description,
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
        navigate(buildAdminBooksPath());
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
      const values = settingsForm.getValues();
      await api.updateAdminSettings({
        [APP_SETTING_KEYS.OPENROUTER_API_KEY]: values.openRouterApiKey,
        [APP_SETTING_KEYS.GOOGLE_API_KEY]: values.googleApiKey,
        [APP_SETTING_KEYS.DEFAULT_PROVIDER]: values.provider,
        [APP_SETTING_KEYS.DEFAULT_MODEL]: values.model,
        [APP_SETTING_KEYS.DEFAULT_PROMPT]: values.prompt,
      });

      await refreshBootstrap(activeTranslation == null);
      setSettingsOpen(false);
      setNotice("Saved settings.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save settings.");
    } finally {
      setIsBusy(false);
    }
  }

  function seedStageFromPreview() {
    replaceStagedChapters(
      chapterPreview.map((chapter, index) => ({
        ...chapter,
        position: index,
      })),
    );
  }

  function replaceStage(chapters: SplitChapterInput[]) {
    replaceStagedChapters(
      chapters.map((entry, position) => ({
        ...entry,
        position,
      })),
    );
  }

  function updateStagedChapter(index: number, key: keyof SplitChapterInput, value: string | null) {
    const current = bookForm.getValues("stagedChapters");
    replaceStage(
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
    const current = bookForm.getValues("stagedChapters");
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= current.length) {
      return;
    }

    const next = [...current];
    const [chapter] = next.splice(index, 1);
    if (!chapter) {
      return;
    }

    next.splice(targetIndex, 0, chapter);
    replaceStage(next);
  }

  function deleteStagedChapter(index: number) {
    const current = bookForm.getValues("stagedChapters");
    replaceStage(current.filter((_, chapterIndex) => chapterIndex !== index));
  }

  function splitStagedChapter(index: number) {
    const current = bookForm.getValues("stagedChapters");
    const chapter = current[index];
    if (!chapter) {
      return;
    }

    const parts = chapter.sourceText
      .split(/\n\s*\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (parts.length < 2) {
      return;
    }

    const firstPart = parts[0];
    if (!firstPart) {
      return;
    }

    const next = [...current];
    next.splice(
      index,
      1,
      {
        ...chapter,
        title: `${chapter.title} I`,
        slug: `${chapter.slug}-1`,
        sourceText: firstPart,
      },
      {
        ...chapter,
        title: `${chapter.title} II`,
        slug: `${chapter.slug}-2`,
        sourceText: parts.slice(1).join("\n\n"),
      },
    );

    replaceStage(next);
  }

  function mergeStagedChapter(index: number) {
    const current = bookForm.getValues("stagedChapters");
    if (index === 0) {
      return;
    }

    const previous = current[index - 1];
    const chapter = current[index];
    if (!previous || !chapter) {
      return;
    }

    const next = [...current];
    next.splice(index - 1, 2, {
      ...previous,
      sourceText: `${previous.sourceText}\n\n${chapter.sourceText}`.trim(),
      title: `${previous.title} / ${chapter.title}`,
    });

    replaceStage(next);
  }

  async function createBook() {
    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const values = bookForm.getValues();
      const created = await api.createAdminBook({
        title: values.title,
        author: values.author || undefined,
        originalLanguage: values.originalLanguage || undefined,
        description: values.description || undefined,
        chapters: values.stagedChapters.map(
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
      resetBookForm();
      resetTranslationForm();
      setSelectedBook(created);
      setTranslations([]);
      setActiveTranslation(null);
      setValidation(null);
      setSelectedChapterId(null);
      navigate(buildAdminBookPath(created.book.slug));
      setNotice(`Created draft book '${created.book.title}'.`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create book.");
    } finally {
      setIsBusy(false);
    }
  }

  const hydrateActiveTranslation = useCallback(
    (translation: AdminTranslationDetail, preferredChapterId?: string | null) => {
      setActiveTranslation(translation);
      translationForm.reset(buildTranslationFormValues(translation));

      const nextChapterId =
        (preferredChapterId && translation.chapters.some((chapter) => chapter.chapterId === preferredChapterId)
          ? preferredChapterId
          : null) ??
        translation.chapters[0]?.chapterId ??
        null;

      setSelectedChapterId(nextChapterId);
    },
    [translationForm],
  );

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      try {
        const payload = await api.getAdminBootstrap();
        if (!isCancelled) {
          applyBootstrapSettings(payload, true);
        }
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
  }, [applyBootstrapSettings]);

  useEffect(() => {
    if (route.screen === "books" || route.screen === "create-book") {
      setSelectedBook(null);
      setTranslations([]);
      setActiveTranslation(null);
      setValidation(null);
      setSelectedChapterId(null);

      return;
    }

    if (route.screen === "translations") {
      const { bookSlug } = route;
      let isCancelled = false;

      async function loadBookRoute() {
        setIsBusy(true);
        setError(null);

        try {
          await refreshBookContext(bookSlug);
          if (!isCancelled) {
            setActiveTranslation(null);
            setValidation(null);
            setSelectedChapterId(null);
          }
        } catch (loadError) {
          if (!isCancelled) {
            setError(loadError instanceof Error ? loadError.message : "Failed to load book.");
          }
        } finally {
          if (!isCancelled) {
            setIsBusy(false);
          }
        }
      }

      void loadBookRoute();
      return () => {
        isCancelled = true;
      };
    }

    const { translationId } = route;
    let isCancelled = false;

    async function loadTranslationRoute() {
      setIsBusy(true);
      setError(null);

      try {
        const translation = await api.getAdminTranslation(translationId);
        if (isCancelled) {
          return;
        }

        hydrateActiveTranslation(
          translation,
          activeTranslationRef.current?.id === translation.id ? selectedChapterIdRef.current : null,
        );
        await refreshBookContext(translation.bookSlug);
        if (isCancelled) {
          return;
        }

        if (route.screen === "validate") {
          const payload = await api.validateAdminTranslation(translationId);
          if (isCancelled) {
            return;
          }

          setValidation(payload);
          const hasCurrentChapter = payload.chapters.some(
            (chapter) => chapter.chapterId === selectedChapterIdRef.current,
          );
          if (!hasCurrentChapter) {
            setSelectedChapterId(payload.chapters[0]?.chapterId ?? null);
          }
        } else {
          setValidation((current) => (current?.translationId === translation.id ? current : null));
        }
      } catch (loadError) {
        if (!isCancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load translation.");
        }
      } finally {
        if (!isCancelled) {
          setIsBusy(false);
        }
      }
    }

    void loadTranslationRoute();
    return () => {
      isCancelled = true;
    };
  }, [hydrateActiveTranslation, route]);

  async function createTranslation() {
    if (!selectedBook) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setNotice(null);

    try {
      const values = translationForm.getValues();
      const translation = await api.createAdminTranslation(selectedBook.book.slug, {
        title: values.title,
        description: values.description || undefined,
        accessLevel: values.accessLevel,
        provider: values.provider,
        model: values.model,
        thinkingLevel: normalizeThinkingLevelValue(values.thinkingLevel),
        prompt: values.prompt,
        contextBeforeChapterCount: Number(values.contextBeforeChapterCount || 0),
        contextAfterChapterCount: Number(values.contextAfterChapterCount || 0),
      });

      await refreshBookContext(selectedBook.book.slug);
      await refreshBootstrap();
      hydrateActiveTranslation(translation);
      setValidation(null);
      navigate(buildWorkspacePath(translation.id));
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
      navigate(buildWorkspacePath(translation.id));
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
        navigate(buildAdminBookPath(selectedBook.book.slug));
      }
      await refreshBootstrap();

      if (activeTranslation?.id === translation.id) {
        setActiveTranslation(null);
        setValidation(null);
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

  function openTranslation(translationId: string) {
    navigate(buildWorkspacePath(translationId));
  }

  async function saveTranslationSettings(options?: { refreshState?: boolean }) {
    if (!activeTranslation) {
      return null;
    }

    const values = translationForm.getValues();
    const updated = await api.updateAdminTranslation(activeTranslation.id, {
      name: values.title || activeTranslation.name,
      slug: values.slug || activeTranslation.slug,
      description: values.description,
      accessLevel: values.accessLevel,
      provider: values.provider,
      model: values.model,
      thinkingLevel: normalizeThinkingLevelValue(values.thinkingLevel),
      prompt: values.prompt,
      contextBeforeChapterCount: Number(values.contextBeforeChapterCount || 0),
      contextAfterChapterCount: Number(values.contextAfterChapterCount || 0),
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
        navigate(buildValidationPath(activeTranslation.id));
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
    if (!issue?.chapterId || !activeTranslation) {
      return;
    }

    setSelectedChapterId(issue.chapterId);
    navigate(buildWorkspacePath(activeTranslation.id));
  }

  function updateChapterEditor(updater: (current: ChapterEditorState) => ChapterEditorState) {
    setChapterEditor((current) => (current ? updater(current) : current));
  }

  const breadcrumbs = buildBreadcrumbs({
    route,
    selectedBookTitle: selectedBook?.book.title ?? null,
    activeTranslationName: activeTranslation?.name ?? null,
    onBooks: goToBooks,
    onCreateBook: goToCreateBook,
    onTranslations: selectedBook ? goToTranslations : null,
    onWorkspace: activeTranslation ? () => navigate(buildWorkspacePath(activeTranslation.id)) : null,
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
                route.screen === "books"
                  ? "bg-ink text-paper"
                  : "border border-border/70 bg-paper/80 text-ink hover:border-accent/50"
              }`}
            >
              Books
            </button>
            <button
              type="button"
              onClick={goToCreateBook}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                route.screen === "create-book"
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
        </header>

        {isLoading ? <Panel title="Loading">Loading admin data.</Panel> : null}
        {error ? <StatusPanel title="Error" body={error} /> : null}
        {notice ? <StatusPanel title="Status" body={notice} tone="notice" /> : null}

        {route.screen === "books" ? (
          <BooksScreen
            books={bootstrap?.books ?? []}
            breadcrumbs={breadcrumbs}
            onCreateBook={goToCreateBook}
            onOpenBook={openBook}
            onEditBook={openBookMetadataEditor}
            onDeleteBook={(book) => void deleteBookFromList(book)}
          />
        ) : null}

        {route.screen === "create-book" ? (
          <CreateBookScreen
            form={bookForm}
            breadcrumbs={breadcrumbs}
            stagedChapters={stagedChapters}
            chapterPreviewCount={chapterPreview.length}
            isBusy={isBusy}
            onBack={goToBooks}
            onSeedStageFromPreview={seedStageFromPreview}
            onUpdateStagedChapter={updateStagedChapter}
            onMoveStagedChapter={moveStagedChapter}
            onDeleteStagedChapter={deleteStagedChapter}
            onSplitStagedChapter={splitStagedChapter}
            onMergeStagedChapter={mergeStagedChapter}
            onCreateBook={() => void createBook()}
          />
        ) : null}

        {route.screen === "translations" ? (
          <TranslationsScreen
            breadcrumbs={breadcrumbs}
            selectedBook={selectedBook}
            translations={translations}
            selectedBookStatus={selectedBookStatus ?? "draft"}
            importTranslationInputRef={importTranslationInputRef}
            translationForm={translationForm}
            isBusy={isBusy}
            onBack={goToBooks}
            onPromptImport={promptTranslationImport}
            onImportTranslation={(event) => void importTranslationFromFile(event)}
            onCreateTranslation={() => void createTranslation()}
            onOpenTranslation={openTranslation}
            onDeleteTranslation={(translation) => void deleteTranslationFromList(translation)}
            onUnpublishTranslation={(translation) => void unpublishTranslationFromList(translation)}
          />
        ) : null}

        {route.screen === "workspace" && activeTranslation ? (
          <WorkspaceScreen
            breadcrumbs={breadcrumbs}
            activeTranslation={activeTranslation}
            validation={validation}
            selectedChapterId={selectedChapterId}
            currentWorkspaceChapter={currentWorkspaceChapter}
            currentValidationChapter={currentValidationChapter}
            chapterEditor={chapterEditor}
            sourceReconstructionMatches={sourceReconstructionMatches}
            chapterIsDirty={chapterIsDirty}
            translationForm={translationForm}
            isBusy={isBusy}
            translationMetadataIsDirty={translationMetadataIsDirty}
            onBack={goToTranslations}
            onValidate={() => void validateCurrentTranslation()}
            onSelectChapter={setSelectedChapterId}
            onSaveMetadata={() => void saveTranslationSettings()}
            onGenerateCurrentChapter={() => void generateCurrentChapter()}
            onUpdateChapterEditor={updateChapterEditor}
            onSaveChapter={() => void saveCurrentChapter()}
          />
        ) : null}

        {route.screen === "validate" && validation && activeTranslation ? (
          <ValidationScreen
            breadcrumbs={breadcrumbs}
            activeTranslation={activeTranslation}
            validation={validation}
            selectedChapterId={selectedChapterId}
            validationPreviewChapter={validationPreviewChapter}
            isBusy={isBusy}
            onContinueEditing={() => navigate(buildWorkspacePath(activeTranslation.id))}
            onRevalidate={() => void validateCurrentTranslation({ openResults: true })}
            onPublish={() => void publishActiveTranslation()}
            onUnpublish={() => void unpublishActiveTranslation()}
            onExport={exportTranslationJson}
            onOpenValidationIssue={openValidationIssue}
            onSelectChapter={setSelectedChapterId}
          />
        ) : null}

        <AppVersionFooter />
      </div>

      {settingsOpen ? (
        <SettingsDialog
          form={settingsForm}
          isBusy={isBusy}
          onClose={() => setSettingsOpen(false)}
          onSave={() => void saveSettings()}
        />
      ) : null}

      {editingBook ? (
        <EditBookDialog
          form={editBookForm}
          isBusy={isBusy}
          onClose={closeBookMetadataEditor}
          onSave={() => void saveBookMetadata()}
        />
      ) : null}
    </main>
  );
}

function buildBreadcrumbs(input: {
  route: AdminRoute;
  selectedBookTitle: string | null;
  activeTranslationName: string | null;
  onBooks: () => void;
  onCreateBook: () => void;
  onTranslations: (() => void) | null;
  onWorkspace: (() => void) | null;
}) {
  const breadcrumbs: BreadcrumbItem[] = [
    {
      label: "Admin",
      isCurrent: input.route.screen === "books",
      onClick: input.onBooks,
    },
  ];

  if (input.route.screen === "books") {
    breadcrumbs.push({ label: "Books", isCurrent: true, onClick: null });
    return breadcrumbs;
  }

  if (input.route.screen === "create-book") {
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
      isCurrent: input.route.screen === "translations",
      onClick: input.onTranslations,
    });
  }

  if (input.route.screen === "translations") {
    return breadcrumbs;
  }

  if (input.activeTranslationName) {
    breadcrumbs.push({
      label: input.activeTranslationName,
      isCurrent: input.route.screen === "workspace",
      onClick: input.onWorkspace,
    });
  }

  if (input.route.screen === "workspace") {
    breadcrumbs.push({ label: "Workspace", isCurrent: true, onClick: null });
  }

  if (input.route.screen === "validate") {
    breadcrumbs.push({ label: "Validation", isCurrent: true, onClick: null });
  }

  return breadcrumbs;
}
