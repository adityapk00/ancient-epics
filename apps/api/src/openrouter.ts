import type { AdminIngestionChapterRecord, AdminIngestionSessionDetail, ThinkingLevel } from "@ancient-epics/shared";
import { config } from "./config";
import { buildReasoningPayload } from "./reasoning";
import { generateChapterWithProvider, type ProviderCallResult } from "./translation-generation";

type OpenRouterChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

export async function generateChapterWithOpenRouter(input: {
  apiKey: string;
  model: string;
  thinkingLevel: ThinkingLevel | null;
  prompt: string;
  session: AdminIngestionSessionDetail;
  chapter: AdminIngestionChapterRecord;
  previousChapters?: AdminIngestionChapterRecord[];
  nextChapters?: AdminIngestionChapterRecord[];
  publicAppUrl?: string;
}): Promise<string> {
  return generateChapterWithProvider({
    provider: "openrouter",
    model: input.model,
    thinkingLevel: input.thinkingLevel,
    prompt: input.prompt,
    session: input.session,
    chapter: input.chapter,
    previousChapters: input.previousChapters,
    nextChapters: input.nextChapters,
    callModel: ({ model, thinkingLevel, systemPrompt, userPrompt }) =>
      callOpenRouterChat({
        apiKey: input.apiKey,
        model,
        thinkingLevel,
        publicAppUrl: input.publicAppUrl,
        systemPrompt,
        userPrompt,
      }),
    logEntry: writeOpenRouterLog,
  });
}

async function callOpenRouterChat(input: {
  apiKey: string;
  model: string;
  thinkingLevel: ThinkingLevel | null;
  publicAppUrl?: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<ProviderCallResult> {
  const requestPayload: Record<string, unknown> = {
    model: input.model,
    temperature: 0.2,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userPrompt },
    ],
  };

  const reasoningPayload = buildReasoningPayload({ thinkingLevel: input.thinkingLevel });
  if (reasoningPayload) {
    requestPayload.reasoning = reasoningPayload;
    requestPayload.include_reasoning = true;
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": input.publicAppUrl ?? "http://127.0.0.1:5173",
      "X-Title": "Ancient Epics Admin",
    },
    body: JSON.stringify(requestPayload),
  });

  const payload = (await response.json()) as OpenRouterChatResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenRouter request failed with status ${response.status}.`);
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return { requestPayload, responseStatus: response.status, responsePayload: payload, extractedContent: content };
  }

  if (Array.isArray(content)) {
    const merged = content
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("\n")
      .trim();
    if (merged) {
      return { requestPayload, responseStatus: response.status, responsePayload: payload, extractedContent: merged };
    }
  }

  throw new Error("OpenRouter returned an empty message payload.");
}

async function writeOpenRouterLog(entry: Record<string, unknown>): Promise<void> {
  if (!config.enableLogging) {
    return;
  }

  console.log("[openrouter]", JSON.stringify(entry, null, 2));
}
