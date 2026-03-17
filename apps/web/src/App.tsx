import { useEffect, useState, type FormEvent } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";

import AdminApp from "./AdminApp";
import ReaderApp from "./ReaderApp";
import { api } from "./lib/api";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ReaderApp />} />
      <Route path="/books/:bookSlug" element={<ReaderApp />} />
      <Route path="/books/:bookSlug/translations/:translationSlug/:chapterSlug" element={<ReaderApp />} />
      <Route path="/admin/*" element={<AdminSection />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AdminSection() {
  const navigate = useNavigate();
  const [isUnlocked, setIsUnlocked] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    async function loadAdminSession() {
      try {
        const payload = await api.getAdminSession();
        if (!isCancelled) {
          setIsUnlocked(payload.authenticated);
        }
      } catch (loadError) {
        if (!isCancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load admin session.");
          setIsUnlocked(false);
        }
      }
    }

    void loadAdminSession();
    return () => {
      isCancelled = true;
    };
  }, []);

  async function unlockAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setError(null);

    try {
      const payload = await api.loginAdmin({ password });
      setIsUnlocked(payload.authenticated);
      setPassword("");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Failed to unlock admin.");
    } finally {
      setIsBusy(false);
    }
  }

  async function lockAdmin() {
    setIsBusy(true);
    setError(null);

    try {
      await api.logoutAdmin();
      setIsUnlocked(false);
      setPassword("");
      navigate("/admin", { replace: true });
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "Failed to lock admin.");
    } finally {
      setIsBusy(false);
    }
  }

  if (isUnlocked == null) {
    return (
      <main className="min-h-screen bg-paper px-6 py-8 text-ink lg:px-10">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl items-center justify-center">
          <p className="text-base text-ink/70">Loading admin...</p>
        </div>
      </main>
    );
  }

  if (!isUnlocked) {
    return (
      <main className="min-h-screen bg-paper px-6 py-8 text-ink lg:px-10">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl items-center">
          <section className="grid w-full gap-6 rounded-[32px] border border-border/70 bg-white/85 p-8 shadow-panel backdrop-blur lg:grid-cols-[1.15fr_420px] lg:p-10">
            <div className="space-y-6">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent">Ancient Epics</p>
              <div className="space-y-3">
                <h1 className="font-display text-5xl leading-tight text-ink">Admin</h1>
                <p className="max-w-2xl text-base leading-8 text-ink/72">
                  The ingestion pipeline and editorial workspace are protected by the admin password stored in D1. Use
                  the reader homepage for published books and translations.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate("/")}
                className="rounded-full border border-border/70 bg-paper/85 px-4 py-2 text-sm font-semibold transition hover:border-accent/50"
              >
                Back To Library
              </button>
            </div>

            <form onSubmit={unlockAdmin} className="rounded-[28px] border border-border/70 bg-paper/82 p-6">
              <label className="block text-sm font-semibold text-ink/75" htmlFor="admin-password">
                Password
              </label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-3 w-full rounded-2xl border border-border/80 bg-white px-4 py-3 text-base text-ink outline-none transition focus:border-accent/70"
                placeholder="Enter admin password"
              />
              {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
              <button
                type="submit"
                disabled={isBusy}
                className="mt-5 w-full rounded-full bg-ink px-4 py-3 text-sm font-semibold text-paper transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isBusy ? "Checking..." : "Enter Admin"}
              </button>
            </form>
          </section>
        </div>
      </main>
    );
  }

  return (
    <div className="relative">
      <div className="fixed bottom-4 right-4 z-50 flex flex-wrap justify-end gap-3">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="rounded-full border border-border/70 bg-paper/90 px-4 py-2 text-sm font-semibold text-ink shadow-panel backdrop-blur transition hover:border-accent/50"
        >
          Library
        </button>
        <button
          type="button"
          onClick={() => void lockAdmin()}
          className="rounded-full border border-border/70 bg-white/90 px-4 py-2 text-sm font-semibold text-ink shadow-panel backdrop-blur transition hover:border-accent/50"
        >
          Lock Admin
        </button>
      </div>
      <AdminApp />
    </div>
  );
}
