import type { ThinkingLevel } from "@ancient-epics/shared";

export function normalizeThinkingLevel(value: ThinkingLevel | null | undefined): ThinkingLevel | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (["none", "minimal", "low", "medium", "high", "xhigh"].includes(value)) {
    return value;
  }

  return null;
}

export function buildReasoningPayload(input: { thinkingLevel: ThinkingLevel | null }): Record<string, unknown> | null {
  if (input.thinkingLevel === null) {
    return null;
  }

  if (input.thinkingLevel === "none") {
    return { enabled: false };
  }

  return {
    enabled: true,
    effort: input.thinkingLevel,
  };
}
