export type ChapterSplitMode = "single" | "heading" | "delimiter";

export interface SplitChapterDraft {
  position: number;
  title: string;
  slug: string;
  sourceText: string;
  sourceChapterSlug: string | null;
}

export function splitSourceTextIntoChapters(input: {
  rawText: string;
  splitMode: ChapterSplitMode;
  headingPattern: string;
  delimiter: string;
}): SplitChapterDraft[] {
  const rawText = input.rawText.trim();

  if (!rawText) {
    return [];
  }

  if (input.splitMode === "single") {
    return [createDraftChapter(0, "Chapter 1", rawText)];
  }

  if (input.splitMode === "delimiter") {
    const delimiter = input.delimiter || "\n\n\n";

    return rawText
      .split(delimiter)
      .map((section) => section.trim())
      .filter(Boolean)
      .map((section, index) => createDraftChapter(index, `Chapter ${index + 1}`, section));
  }

  const pattern = input.headingPattern.trim() || "^(book|chapter|canto|scroll)\\b.*$";
  const matcher = new RegExp(pattern, "i");
  const lines = rawText.split(/\r?\n/);
  const chapters: Array<{ title: string; lines: string[] }> = [];
  let currentTitle = "Chapter 1";
  let currentLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed && matcher.test(trimmed)) {
      if (currentLines.length > 0) {
        chapters.push({ title: currentTitle, lines: currentLines });
      }
      currentTitle = trimmed;
      currentLines = [];
      continue;
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    chapters.push({ title: currentTitle, lines: currentLines });
  }

  return chapters
    .map((chapter, index) =>
      createDraftChapter(index, chapter.title, chapter.lines.join("\n").trim()),
    )
    .filter((chapter) => chapter.sourceText.length > 0);
}

function createDraftChapter(
  position: number,
  title: string,
  sourceText: string,
): SplitChapterDraft {
  return {
    position,
    title,
    slug: slugify(title || `chapter-${position + 1}`),
    sourceText,
    sourceChapterSlug: null,
  };
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "untitled"
  );
}