import { useEffect, useMemo, useState, type FormEvent } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";

import type {
  AuthUser,
  BookDetail,
  BookSummary,
  ReaderChapterPayload,
  TranslationSummary,
} from "@ancient-epics/shared";

import type { BreadcrumbItem } from "./components/BreadcrumbTrail";
import { StatusPanel } from "./components/StatusPanel";
import { api, ApiError } from "./lib/api";
import { AuthDialog } from "./reader/AuthDialog";
import { BooksScreen } from "./reader/BooksScreen";
import { ReaderScreen } from "./reader/ReaderScreen";
import { TranslationsScreen } from "./reader/TranslationsScreen";

type ReaderLoadState = "idle" | "loading" | "ready" | "error";
type AuthMode = "signup" | "login";
type ReaderRoute =
  | { screen: "books" }
  | { screen: "translations"; bookSlug: string }
  | { screen: "reader"; bookSlug: string; translationSlug: string; chapterSlug: string };
type ProtectedIntent =
  | { kind: "book"; bookSlug: string }
  | { kind: "translation"; bookSlug: string; translationSlug: string }
  | null;

function buildLastReadStorageKey(bookSlug: string, translationSlug: string): string {
  return `ancient-epics:last-read:${bookSlug}:${translationSlug}`;
}

function getStoredLastReadChapter(bookSlug: string, translationSlug: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(buildLastReadStorageKey(bookSlug, translationSlug));
}

function setStoredLastReadChapter(bookSlug: string, translationSlug: string, chapterSlug: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(buildLastReadStorageKey(bookSlug, translationSlug), chapterSlug);
}

function buildBookPath(bookSlug: string): string {
  return `/books/${bookSlug}`;
}

function buildReaderPath(bookSlug: string, translationSlug: string, chapterSlug: string): string {
  return `/books/${bookSlug}/translations/${translationSlug}/${chapterSlug}`;
}

function getPreferredChapterSlug(book: BookDetail, translationSlug: string): string | null {
  const firstChapterSlug = book.chapters[0]?.slug ?? null;
  const storedChapterSlug = getStoredLastReadChapter(book.slug, translationSlug);

  if (storedChapterSlug && book.chapters.some((chapter) => chapter.slug === storedChapterSlug)) {
    return storedChapterSlug;
  }

  return firstChapterSlug;
}

function getReaderRoute(pathname: string): ReaderRoute {
  const readerMatch = matchPath("/books/:bookSlug/translations/:translationSlug/:chapterSlug", pathname);
  if (readerMatch?.params.bookSlug && readerMatch.params.translationSlug && readerMatch.params.chapterSlug) {
    return {
      screen: "reader",
      bookSlug: readerMatch.params.bookSlug,
      translationSlug: readerMatch.params.translationSlug,
      chapterSlug: readerMatch.params.chapterSlug,
    };
  }

  const translationMatch = matchPath("/books/:bookSlug", pathname);
  if (translationMatch?.params.bookSlug) {
    return {
      screen: "translations",
      bookSlug: translationMatch.params.bookSlug,
    };
  }

  return { screen: "books" };
}

export default function ReaderApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const route = useMemo(() => getReaderRoute(location.pathname), [location.pathname]);

  const [books, setBooks] = useState<BookSummary[]>([]);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>("signup");
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authPromptMessage, setAuthPromptMessage] = useState<string | null>(null);
  const [pendingProtectedIntent, setPendingProtectedIntent] = useState<ProtectedIntent>(null);
  const [pendingTranslationAfterAuth, setPendingTranslationAfterAuth] = useState<{
    bookSlug: string;
    translationSlug: string;
  } | null>(null);
  const [selectedBook, setSelectedBook] = useState<BookDetail | null>(null);
  const [chapterPayload, setChapterPayload] = useState<ReaderChapterPayload | null>(null);
  const [isLoadingBooks, setIsLoadingBooks] = useState(true);
  const [isLoadingBook, setIsLoadingBook] = useState(false);
  const [isLoadingReader, setIsLoadingReader] = useState(false);
  const [readerLoadState, setReaderLoadState] = useState<ReaderLoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [translationUnavailableMessage, setTranslationUnavailableMessage] = useState<string | null>(null);

  const selectedTranslationSlug = route.screen === "reader" ? route.translationSlug : null;
  const selectedChapterSlug = route.screen === "reader" ? route.chapterSlug : null;

  useEffect(() => {
    let isCancelled = false;

    async function loadAuthSession() {
      try {
        const payload = await api.getAuthSession();
        if (!isCancelled) {
          setAuthUser(payload.user);
        }
      } catch (loadError) {
        if (!isCancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load session.");
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingSession(false);
        }
      }
    }

    void loadAuthSession();
    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function loadBooks() {
      setIsLoadingBooks(true);
      setError(null);

      try {
        const payload = await api.listBooks();
        if (!isCancelled) {
          setBooks(payload.books);
        }
      } catch (loadError) {
        if (!isCancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load books.");
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingBooks(false);
        }
      }
    }

    void loadBooks();
    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (route.screen === "books") {
      setSelectedBook(null);
      setChapterPayload(null);
      setTranslationUnavailableMessage(null);
      setReaderLoadState("idle");
      return;
    }

    const { bookSlug } = route;
    let isCancelled = false;

    async function loadBook() {
      setIsLoadingBook(true);
      setError(null);

      try {
        const payload = await api.getBook(bookSlug);
        if (!isCancelled) {
          setSelectedBook(payload);
        }
      } catch (loadError) {
        if (!isCancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load book.");
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingBook(false);
        }
      }
    }

    void loadBook();
    return () => {
      isCancelled = true;
    };
  }, [route]);

  useEffect(() => {
    if (route.screen !== "reader" || !selectedBook || selectedBook.slug !== route.bookSlug) {
      setChapterPayload(null);
      setTranslationUnavailableMessage(null);
      setReaderLoadState("idle");
      return;
    }

    const { bookSlug, chapterSlug, translationSlug } = route;

    if (!selectedBook.chapters.some((chapter) => chapter.slug === chapterSlug)) {
      const preferredChapterSlug = getPreferredChapterSlug(selectedBook, translationSlug);
      if (preferredChapterSlug) {
        navigate(buildReaderPath(selectedBook.slug, translationSlug, preferredChapterSlug), { replace: true });
      } else {
        navigate(buildBookPath(selectedBook.slug), { replace: true });
      }
      return;
    }

    let isCancelled = false;

    async function loadReaderContent() {
      setIsLoadingReader(true);
      setReaderLoadState("loading");
      setError(null);

      try {
        const chapter = await api.getChapter(bookSlug, chapterSlug, translationSlug);
        if (isCancelled) {
          return;
        }

        setChapterPayload(chapter);
        setTranslationUnavailableMessage(
          chapter.translation ? null : "This translation is not available for the selected chapter yet.",
        );
        setReaderLoadState("ready");
      } catch (loadError) {
        if (!isCancelled) {
          if (loadError instanceof ApiError && loadError.code === "auth_required") {
            setReaderLoadState("idle");
            openAuthDialog({
              mode: "signup",
              message: "Sign up for free to unlock this translation.",
              intent: { kind: "translation", bookSlug, translationSlug },
            });
            navigate(buildBookPath(bookSlug), { replace: true });
            return;
          }

          setError(loadError instanceof Error ? loadError.message : "Failed to load reader content.");
          setReaderLoadState("error");
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingReader(false);
        }
      }
    }

    void loadReaderContent();
    return () => {
      isCancelled = true;
    };
  }, [navigate, route, selectedBook]);

  useEffect(() => {
    if (!authUser || !pendingTranslationAfterAuth || selectedBook?.slug !== pendingTranslationAfterAuth.bookSlug) {
      return;
    }

    const preferredChapterSlug = getPreferredChapterSlug(selectedBook, pendingTranslationAfterAuth.translationSlug);
    setPendingTranslationAfterAuth(null);

    if (!preferredChapterSlug) {
      navigate(buildBookPath(selectedBook.slug));
      return;
    }

    navigate(buildReaderPath(selectedBook.slug, pendingTranslationAfterAuth.translationSlug, preferredChapterSlug));
  }, [authUser, navigate, pendingTranslationAfterAuth, selectedBook]);

  useEffect(() => {
    if (route.screen !== "reader" || !selectedBook || selectedBook.slug !== route.bookSlug) {
      return;
    }

    setStoredLastReadChapter(selectedBook.slug, route.translationSlug, route.chapterSlug);
  }, [route, selectedBook]);

  const selectedTranslation =
    selectedBook?.translations.find((translation) => translation.slug === selectedTranslationSlug) ?? null;
  const selectedChapter = selectedBook?.chapters.find((chapter) => chapter.slug === selectedChapterSlug) ?? null;
  const activeChapterTitle = chapterPayload?.chapter.title ?? selectedChapter?.title ?? "Chapter";

  const chapterIndex =
    selectedBook && selectedChapter
      ? selectedBook.chapters.findIndex((chapter) => chapter.slug === selectedChapter.slug)
      : -1;
  const previousChapter = chapterIndex > 0 && selectedBook ? (selectedBook.chapters[chapterIndex - 1] ?? null) : null;
  const nextChapter =
    chapterIndex >= 0 && selectedBook && chapterIndex < selectedBook.chapters.length - 1
      ? (selectedBook.chapters[chapterIndex + 1] ?? null)
      : null;

  const hasLockedTranslations = selectedBook?.translations.some(
    (translation) => translation.accessLevel === "loggedin",
  );

  function openAuthDialog(input?: { mode?: AuthMode; message?: string | null; intent?: ProtectedIntent }) {
    setAuthMode(input?.mode ?? "signup");
    setAuthPromptMessage(input?.message ?? null);
    setPendingProtectedIntent(input?.intent ?? null);
    setAuthError(null);
    setIsAuthDialogOpen(true);
  }

  function closeAuthDialog() {
    setIsAuthDialogOpen(false);
    setAuthError(null);
    setAuthPromptMessage(null);
    setPendingProtectedIntent(null);
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmittingAuth(true);
    setAuthError(null);

    try {
      const payload =
        authMode === "signup"
          ? await api.signup({ email: authEmail, password: authPassword })
          : await api.login({ email: authEmail, password: authPassword });

      setAuthUser(payload.user);
      setAuthPassword("");
      setIsAuthDialogOpen(false);
      setAuthPromptMessage(null);
      setAuthError(null);

      const intent = pendingProtectedIntent;
      setPendingProtectedIntent(null);

      if (!intent) {
        return;
      }

      if (intent.kind === "book") {
        navigate(buildBookPath(intent.bookSlug));
        return;
      }

      if (selectedBook?.slug === intent.bookSlug) {
        const preferredChapterSlug = getPreferredChapterSlug(selectedBook, intent.translationSlug);
        if (preferredChapterSlug) {
          navigate(buildReaderPath(selectedBook.slug, intent.translationSlug, preferredChapterSlug));
        }
        return;
      }

      setPendingTranslationAfterAuth({
        bookSlug: intent.bookSlug,
        translationSlug: intent.translationSlug,
      });
      navigate(buildBookPath(intent.bookSlug));
    } catch (submitError) {
      setAuthError(submitError instanceof Error ? submitError.message : "Authentication failed.");
    } finally {
      setIsSubmittingAuth(false);
    }
  }

  async function logout() {
    try {
      await api.logout();
      setAuthUser(null);
      navigate("/");
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "Failed to log out.");
    }
  }

  function openBook(bookSlug: string) {
    setChapterPayload(null);
    setTranslationUnavailableMessage(null);
    setReaderLoadState("idle");
    navigate(buildBookPath(bookSlug));
  }

  function openTranslation(translationSlug: string) {
    if (!selectedBook) {
      return;
    }

    const preferredChapterSlug = getPreferredChapterSlug(selectedBook, translationSlug);
    if (!preferredChapterSlug) {
      return;
    }

    setChapterPayload(null);
    setTranslationUnavailableMessage(null);
    setReaderLoadState("loading");
    navigate(buildReaderPath(selectedBook.slug, translationSlug, preferredChapterSlug));
  }

  function openChapter(chapterSlug: string) {
    if (!selectedBook || !selectedTranslationSlug) {
      return;
    }

    setReaderLoadState("loading");
    navigate(buildReaderPath(selectedBook.slug, selectedTranslationSlug, chapterSlug));
  }

  function handleOpenBook(book: BookSummary) {
    if (!authUser && book.accessLevel === "loggedin") {
      openAuthDialog({
        mode: "signup",
        message: "Sign up for free to unlock this book.",
        intent: { kind: "book", bookSlug: book.slug },
      });
      return;
    }

    openBook(book.slug);
  }

  function handleOpenTranslation(translation: TranslationSummary) {
    if (!authUser && translation.accessLevel === "loggedin" && selectedBook) {
      openAuthDialog({
        mode: "signup",
        message: "Sign up for free to read this translation.",
        intent: {
          kind: "translation",
          bookSlug: selectedBook.slug,
          translationSlug: translation.slug,
        },
      });
      return;
    }

    openTranslation(translation.slug);
  }

  const breadcrumbs = useMemo(() => {
    const items: BreadcrumbItem[] = [
      {
        label: "Library",
        isCurrent: route.screen === "books",
        onClick: route.screen === "books" ? null : () => navigate("/"),
      },
    ];

    if (route.screen !== "books" && selectedBook) {
      items.push({
        label: selectedBook.title,
        isCurrent: route.screen === "translations",
        onClick: route.screen === "translations" ? null : () => navigate(buildBookPath(selectedBook.slug)),
      });
    }

    if (route.screen === "reader" && selectedTranslation) {
      items.push({
        label: selectedTranslation.name,
        isCurrent: false,
        onClick: () => navigate(buildBookPath(route.bookSlug)),
      });
    }

    if (route.screen === "reader" && selectedChapter) {
      items.push({
        label: selectedChapter.title,
        isCurrent: true,
        onClick: null,
      });
    }

    return items;
  }, [navigate, route, selectedBook, selectedChapter, selectedTranslation]);

  return (
    <main className="min-h-screen bg-paper px-6 py-8 text-ink lg:px-10">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-8">
        <header className="flex items-center justify-between gap-4 rounded-full border border-border/70 bg-white/82 px-5 py-3 shadow-panel backdrop-blur">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-accent">Ancient Epics</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {isLoadingSession ? null : authUser ? (
              <>
                <span className="rounded-full border border-border/70 bg-paper/85 px-4 py-2 text-sm text-ink/72">
                  {authUser.email}
                </span>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="rounded-full border border-border/70 bg-paper/90 px-4 py-2 text-sm font-semibold transition hover:border-accent/50"
                >
                  Log Out
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => openAuthDialog({ mode: "login" })}
                  className="rounded-full border border-border/70 bg-paper/90 px-4 py-2 text-sm font-semibold transition hover:border-accent/50"
                >
                  Log In
                </button>
                <button
                  type="button"
                  onClick={() => openAuthDialog({ mode: "signup" })}
                  className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper transition hover:bg-accent"
                >
                  Sign Up
                </button>
              </>
            )}
          </div>
        </header>

        {error ? <StatusPanel title="Error" body={error} /> : null}

        {route.screen === "books" ? (
          <BooksScreen
            books={books}
            breadcrumbs={breadcrumbs}
            isLoadingBooks={isLoadingBooks}
            authUser={authUser}
            onOpenBook={handleOpenBook}
          />
        ) : null}

        {route.screen === "translations" ? (
          <TranslationsScreen
            selectedBook={selectedBook}
            breadcrumbs={breadcrumbs}
            isLoadingBook={isLoadingBook}
            authUser={authUser}
            hasLockedTranslations={hasLockedTranslations ?? false}
            onBack={() => navigate("/")}
            onOpenTranslation={handleOpenTranslation}
          />
        ) : null}

        {route.screen === "reader" ? (
          <ReaderScreen
            selectedBook={selectedBook}
            selectedTranslationName={selectedTranslation?.name ?? null}
            selectedChapter={selectedChapter}
            activeChapterTitle={activeChapterTitle}
            chapterPayload={chapterPayload}
            breadcrumbs={breadcrumbs}
            previousChapter={previousChapter}
            nextChapter={nextChapter}
            isLoadingReader={isLoadingReader}
            readerLoadState={readerLoadState}
            translationUnavailableMessage={translationUnavailableMessage}
            onBack={() => navigate(buildBookPath(route.bookSlug))}
            onOpenChapter={openChapter}
          />
        ) : null}
      </div>

      {isAuthDialogOpen ? (
        <AuthDialog
          authMode={authMode}
          email={authEmail}
          password={authPassword}
          error={authError}
          isBusy={isSubmittingAuth}
          promptMessage={authPromptMessage}
          onClose={closeAuthDialog}
          onModeChange={setAuthMode}
          onEmailChange={setAuthEmail}
          onPasswordChange={setAuthPassword}
          onSubmit={submitAuth}
        />
      ) : null}
    </main>
  );
}
