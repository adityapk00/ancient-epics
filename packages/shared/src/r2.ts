export const R2_EPICS_PREFIX = "epics";

export function buildChapterPrefix(bookSlug: string, chapterSlug: string): string {
  return `${R2_EPICS_PREFIX}/${bookSlug}/${chapterSlug}`;
}

export function buildOriginalChapterKey(bookSlug: string, chapterSlug: string): string {
  return `${buildChapterPrefix(bookSlug, chapterSlug)}/original.json`;
}

export function buildTranslationsPrefix(bookSlug: string, chapterSlug: string): string {
  return `${buildChapterPrefix(bookSlug, chapterSlug)}/translations`;
}

export function buildTranslationChapterKey(bookSlug: string, chapterSlug: string, translationSlug: string): string {
  return `${buildTranslationsPrefix(bookSlug, chapterSlug)}/${translationSlug}.json`;
}
