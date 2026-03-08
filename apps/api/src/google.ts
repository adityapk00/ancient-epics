import { GoogleGenAI } from "@google/genai";
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
    callModel: ({ model, systemPrompt, userPrompt }) =>
      callGoogleGenAi({
        apiKey: input.apiKey,
        model,
        systemPrompt,
        userPrompt,
      }),
    logEntry: writeGoogleLog,
  });
}

async function callGoogleGenAi(input: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<ProviderCallResult> {
  const client = new GoogleGenAI({ apiKey: input.apiKey });
  const requestPayload = {
    model: input.model,
    contents: input.userPrompt,
    config: {
      systemInstruction: input.systemPrompt,
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  } satisfies Record<string, unknown>;

  const response = await client.models.generateContent(requestPayload);
  const extractedContent = extractGoogleText(response);
  if (!extractedContent) {
    throw new Error("Google GenAI returned an empty message payload.");
  }

  return {
    requestPayload,
    responseStatus: 200,
    responsePayload: response,
    extractedContent,
  };
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
