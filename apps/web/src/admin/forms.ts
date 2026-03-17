import {
  APP_SETTING_KEYS,
  normalizeProvider,
  type AccessLevel,
  type AdminBookSummary,
  type AdminBootstrapPayload,
  type AdminTranslationDetail,
  type AiProvider,
} from "@ancient-epics/shared";

import type { ChapterSplitMode, SplitChapterInput } from "../lib/chapter-splitting";

export const DEFAULT_PROVIDER: AiProvider = "google";
export const DEFAULT_MODEL = "gemini-3-flash-preview";
export const DEFAULT_HEADING_PATTERN = "^(book|chapter|canto|scroll|House)\\b.*$";
export const PROVIDER_OPTIONS = [
  { value: "google", label: "Google Gemini SDK" },
  { value: "openrouter", label: "OpenRouter" },
] as const;
export const THINKING_LEVEL_OPTIONS = [
  { value: "", label: "Default" },
  { value: "none", label: "Off" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "X-High" },
] as const;
export const ACCESS_LEVEL_OPTIONS = [
  { value: "public", label: "Public / Free To Read" },
  { value: "loggedin", label: "Logged In / Free Account Required" },
] as const;

export type SettingsFormValues = {
  openRouterApiKey: string;
  googleApiKey: string;
  provider: AiProvider;
  model: string;
  prompt: string;
};

export type CreateBookFormValues = {
  title: string;
  author: string;
  originalLanguage: string;
  description: string;
  rawText: string;
  splitMode: ChapterSplitMode;
  headingPattern: string;
  delimiter: string;
  stagedChapters: SplitChapterInput[];
};

export type TranslationFormValues = {
  title: string;
  slug: string;
  description: string;
  accessLevel: AccessLevel;
  provider: AiProvider;
  model: string;
  thinkingLevel: string;
  prompt: string;
  contextBeforeChapterCount: string;
  contextAfterChapterCount: string;
};

export type EditBookFormValues = {
  title: string;
  author: string;
  originalLanguage: string;
  description: string;
};

export function buildEmptyCreateBookFormValues(): CreateBookFormValues {
  return {
    title: "",
    author: "",
    originalLanguage: "",
    description: "",
    rawText: "",
    splitMode: "heading",
    headingPattern: DEFAULT_HEADING_PATTERN,
    delimiter: "\n\n\n",
    stagedChapters: [],
  };
}

export function buildSettingsFormValues(payload: AdminBootstrapPayload | null): SettingsFormValues {
  const provider = payload ? normalizeProvider(payload.settings[APP_SETTING_KEYS.DEFAULT_PROVIDER]) : DEFAULT_PROVIDER;

  return {
    openRouterApiKey: payload?.settings[APP_SETTING_KEYS.OPENROUTER_API_KEY] ?? "",
    googleApiKey: payload?.settings[APP_SETTING_KEYS.GOOGLE_API_KEY] ?? "",
    provider,
    model: payload?.settings[APP_SETTING_KEYS.DEFAULT_MODEL] ?? DEFAULT_MODEL,
    prompt: payload?.settings[APP_SETTING_KEYS.DEFAULT_PROMPT] ?? "",
  };
}

export function buildTranslationDefaultValues(payload: AdminBootstrapPayload | null): TranslationFormValues {
  const provider = payload ? normalizeProvider(payload.settings[APP_SETTING_KEYS.DEFAULT_PROVIDER]) : DEFAULT_PROVIDER;

  return {
    title: "",
    slug: "",
    description: "",
    accessLevel: "public",
    provider,
    model: payload?.settings[APP_SETTING_KEYS.DEFAULT_MODEL] ?? DEFAULT_MODEL,
    thinkingLevel: "",
    prompt: payload?.settings[APP_SETTING_KEYS.DEFAULT_PROMPT] ?? "",
    contextBeforeChapterCount: "1",
    contextAfterChapterCount: "1",
  };
}

export function buildTranslationFormValues(translation: AdminTranslationDetail): TranslationFormValues {
  return {
    title: translation.name,
    slug: translation.slug,
    description: translation.description ?? "",
    accessLevel: translation.accessLevel,
    provider: translation.provider,
    model: translation.model,
    thinkingLevel: translation.thinkingLevel ?? "",
    prompt: translation.prompt,
    contextBeforeChapterCount: String(translation.contextBeforeChapterCount),
    contextAfterChapterCount: String(translation.contextAfterChapterCount),
  };
}

export function buildEditBookFormValues(book: AdminBookSummary): EditBookFormValues {
  return {
    title: book.title,
    author: book.author ?? "",
    originalLanguage: book.originalLanguage ?? "",
    description: book.description ?? "",
  };
}
