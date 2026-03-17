import type { FormEvent } from "react";

type AuthMode = "signup" | "login";

export function AuthDialog({
  authMode,
  email,
  password,
  error,
  isBusy,
  promptMessage,
  onClose,
  onModeChange,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: {
  authMode: AuthMode;
  email: string;
  password: string;
  error: string | null;
  isBusy: boolean;
  promptMessage: string | null;
  onClose: () => void;
  onModeChange: (mode: AuthMode) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/28 px-6 py-8 backdrop-blur-sm">
      <div className="w-full max-w-[560px] rounded-[32px] border border-border/70 bg-white/95 p-6 shadow-panel lg:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Ancient Epics</p>
            <h2 className="mt-3 font-display text-4xl text-ink">
              {authMode === "signup" ? "Create Your Free Account" : "Log In"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border/70 bg-paper/90 px-4 py-2 text-sm font-semibold transition hover:border-accent/50"
          >
            Close
          </button>
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => onModeChange("signup")}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              authMode === "signup" ? "bg-ink text-paper" : "border border-border/70 bg-paper/80 text-ink/72"
            }`}
          >
            Sign Up
          </button>
          <button
            type="button"
            onClick={() => onModeChange("login")}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              authMode === "login" ? "bg-ink text-paper" : "border border-border/70 bg-paper/80 text-ink/72"
            }`}
          >
            Log In
          </button>
        </div>

        {promptMessage ? (
          <div className="mt-5 rounded-[24px] border border-border/70 bg-paper/68 px-5 py-4 text-sm leading-7 text-ink/74">
            {promptMessage}
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              className="rounded-2xl border border-border/70 bg-paper/70 px-4 py-3 text-base text-ink outline-none transition focus:border-accent"
              autoComplete="email"
              placeholder="you@example.com"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              className="rounded-2xl border border-border/70 bg-paper/70 px-4 py-3 text-base text-ink outline-none transition focus:border-accent"
              autoComplete={authMode === "signup" ? "new-password" : "current-password"}
              placeholder="At least 8 characters"
            />
          </label>

          {error ? <p className="text-sm text-red-700">{error}</p> : null}

          <button
            type="submit"
            disabled={isBusy}
            className="w-full rounded-full bg-ink px-4 py-3 text-sm font-semibold text-paper transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? "Working..." : authMode === "signup" ? "Sign Up For Free" : "Log In"}
          </button>
        </form>
      </div>
    </div>
  );
}
