import { useEffect, useState, type FormEvent } from "react";

import AdminApp from "./AdminApp";
import ReaderApp from "./ReaderApp";

const ADMIN_PASSWORD = "password";
const ADMIN_UNLOCKED_STORAGE_KEY = "ancient-epics.admin.unlocked";

function getCurrentRoute() {
  return window.location.pathname === "/admin" ? "admin" : "reader";
}

function isAdminUnlocked() {
  return window.localStorage.getItem(ADMIN_UNLOCKED_STORAGE_KEY) === "true";
}

function navigateTo(path: "/" | "/admin") {
  if (window.location.pathname === path) {
    return;
  }

  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export default function App() {
  const [route, setRoute] = useState<"reader" | "admin">(getCurrentRoute);

  useEffect(() => {
    function handleRouteChange() {
      setRoute(getCurrentRoute());
    }

    window.addEventListener("popstate", handleRouteChange);
    return () => window.removeEventListener("popstate", handleRouteChange);
  }, []);

  if (route === "admin") {
    return <AdminSection />;
  }

  return <ReaderApp />;
}

function AdminSection() {
  const [isUnlocked, setIsUnlocked] = useState(isAdminUnlocked);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function unlockAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password !== ADMIN_PASSWORD) {
      setError("Incorrect password.");
      return;
    }

    window.localStorage.setItem(ADMIN_UNLOCKED_STORAGE_KEY, "true");
    setIsUnlocked(true);
    setPassword("");
    setError(null);
  }

  function leaveAdmin() {
    navigateTo("/");
  }

  function lockAdmin() {
    window.localStorage.removeItem(ADMIN_UNLOCKED_STORAGE_KEY);
    setIsUnlocked(false);
    setPassword("");
    setError(null);
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
                  The ingestion pipeline and editorial workspace now live behind a temporary password gate. Use the
                  reader homepage for published books and translations.
                </p>
              </div>
              <div className="rounded-[24px] border border-border/70 bg-paper/70 p-5 text-sm leading-7 text-ink/68">
                Temporary password: <span className="font-semibold text-ink">password</span>
              </div>
              <button
                type="button"
                onClick={leaveAdmin}
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
                className="mt-5 w-full rounded-full bg-ink px-4 py-3 text-sm font-semibold text-paper transition hover:bg-accent"
              >
                Enter Admin
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
          onClick={leaveAdmin}
          className="rounded-full border border-border/70 bg-paper/90 px-4 py-2 text-sm font-semibold text-ink shadow-panel backdrop-blur transition hover:border-accent/50"
        >
          Library
        </button>
        <button
          type="button"
          onClick={lockAdmin}
          className="rounded-full border border-border/70 bg-white/90 px-4 py-2 text-sm font-semibold text-ink shadow-panel backdrop-blur transition hover:border-accent/50"
        >
          Lock Admin
        </button>
      </div>
      <AdminApp />
    </div>
  );
}
