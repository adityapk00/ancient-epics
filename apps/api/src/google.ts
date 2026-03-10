import {
  GoogleGenAI,
  type GenerateContentParameters,
  type ThinkingConfig,
  ThinkingLevel as GoogleThinkingLevel,
} from "@google/genai";
import type { AdminIngestionChapterRecord, AdminIngestionSessionDetail, ThinkingLevel } from "@ancient-epics/shared";
import { config } from "./config";
import { generateChapterWithProvider, type ProviderCallResult } from "./translation-generation";

export async function generateChapterWithGoogle(input: {
  apiKey: string;
  model: string;
  thinkingLevel: ThinkingLevel | null;
  prompt: string;
  session: AdminIngestionSessionDetail;
  chapter: AdminIngestionChapterRecord;
  previousChapters?: AdminIngestionChapterRecord[];
  nextChapters?: AdminIngestionChapterRecord[];
}): Promise<string> {
  return generateChapterWithProvider({
    provider: "google",
    model: input.model,
    thinkingLevel: input.thinkingLevel,
    prompt: input.prompt,
    session: input.session,
    chapter: input.chapter,
    previousChapters: input.previousChapters,
    nextChapters: input.nextChapters,
    callModel: ({ model, thinkingLevel, systemPrompt, userPrompt }) =>
      callGoogleGenAi({
        apiKey: input.apiKey,
        model,
        thinkingLevel,
        systemPrompt,
        userPrompt,
      }),
    logEntry: writeGoogleLog,
  });
}

async function callGoogleGenAi(input: {
  apiKey: string;
  model: string;
  thinkingLevel: ThinkingLevel | null;
  systemPrompt: string;
  userPrompt: string;
}): Promise<ProviderCallResult> {
  const client = new GoogleGenAI({ apiKey: input.apiKey });
  const thinkingConfig = buildGoogleThinkingConfig(input.thinkingLevel);
  const requestPayload: GenerateContentParameters = {
    model: input.model,
    contents: input.userPrompt,
    config: {
      systemInstruction: input.systemPrompt,
      temperature: 0.2,
      responseMimeType: "application/json",
      ...(thinkingConfig ? { thinkingConfig } : {}),
    },
  };

  const response = await client.models.generateContent(requestPayload);
  const extractedContent = extractGoogleText(response);
  if (!extractedContent) {
    throw new Error("Google GenAI returned an empty message payload.");
  }

  return {
    requestPayload: requestPayload as unknown as Record<string, unknown>,
    responseStatus: 200,
    responsePayload: response,
    extractedContent,
  };
}

function buildGoogleThinkingConfig(thinkingLevel: ThinkingLevel | null): ThinkingConfig | null {
  if (thinkingLevel === null) {
    return null;
  }

  if (thinkingLevel === "none") {
    return {
      includeThoughts: false,
      thinkingBudget: 0,
    };
  }

  return {
    includeThoughts: false,
    thinkingLevel: mapGoogleThinkingLevel(thinkingLevel),
  };
}

function mapGoogleThinkingLevel(thinkingLevel: Exclude<ThinkingLevel, null | "none">): GoogleThinkingLevel {
  switch (thinkingLevel) {
    case "minimal":
      return GoogleThinkingLevel.MINIMAL;
    case "low":
      return GoogleThinkingLevel.LOW;
    case "medium":
      return GoogleThinkingLevel.MEDIUM;
    case "high":
    case "xhigh":
      return GoogleThinkingLevel.HIGH;
  }
}

function extractGoogleText(response: unknown): string {
  if (!response || typeof response !== "object") {
    return "";
  }

  const responseWithText = response as { text?: string };
  if (typeof responseWithText.text === "string" && responseWithText.text.trim()) {
    return responseWithText.text.trim();
  }

  const candidates = (
    response as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    }
  ).candidates;

  if (!Array.isArray(candidates)) {
    return "";
  }

  return candidates
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
}

async function writeGoogleLog(entry: Record<string, unknown>): Promise<void> {
  if (!config.enableLogging) {
    return;
  }

  console.log("[google]", JSON.stringify(entry, null, 2));
}
