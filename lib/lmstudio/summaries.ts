import "server-only";

import { formatMessageContentForPrompt } from "@/lib/chat/message-content";
import { messagePartsContainContextCompactionMarker } from "@/lib/chat/context-compaction-marker";
import { resolvePreferredLmStudioModelTarget } from "@/lib/lmstudio/models";
import { type ThreadDetail, type ThreadMessage } from "@/lib/lmstudio/threads";

import { type PromptMode } from "./prompt-modes";
import { getConfiguredContextLengthForMode } from "./context-length";

type SummaryConfig = {
  messageThreshold: number;
  characterThreshold: number;
  maxSummaryCharacters: number;
  maxTranscriptCharacters: number;
};

const summaryConfigByMode: Record<PromptMode, SummaryConfig> = {
  fast: {
    messageThreshold: 8,
    characterThreshold: 5_000,
    maxSummaryCharacters: 3_000,
    maxTranscriptCharacters: 28_000,
  },
  regular: {
    messageThreshold: 10,
    characterThreshold: 7_500,
    maxSummaryCharacters: 5_000,
    maxTranscriptCharacters: 40_000,
  },
  writer: {
    messageThreshold: 8,
    characterThreshold: 9_000,
    maxSummaryCharacters: 4_500,
    maxTranscriptCharacters: 18_000,
  },
  artist: {
    messageThreshold: 8,
    characterThreshold: 6_000,
    maxSummaryCharacters: 2_800,
    maxTranscriptCharacters: 10_000,
  },
};

const summaryPromptByMode: Record<PromptMode, string> = {
  fast: `You compress chat history into tiny working memory for a fast assistant.

Goal:
- Produce the smallest useful summary possible.

Rules:
- Use short bullet points.
- Omit fluff, examples, repeated wording, and long explanations.
- Do not include reasoning traces.
- Do not mention tools unless the result matters to the next reply.
- If there was an incomplete enumeration, provide enough information to continue it till the end.
- Output only the summary.`,
  regular: `You compress chat history into practical working memory for a general assistant.

Rules:
- Prefer concise bullets with short section headers.
- Remove repetition and low-value conversational filler.
- Do not include chain-of-thought or internal reasoning.
- If there was an incomplete enumeration, provide enough information to continue it till the end.
- Output only the summary.`,
  writer: `You are a continuity archivist for a writing assistant.

Preserve:
- characters and relationships
- world facts and lore
- tone, style, and voice requirements
- plot state and chronology
- unresolved arcs, constraints, and continuity rules
- exact details that must remain consistent

Rules:
- Use structured sections.
- Preserve story continuity over brevity, but still compress aggressively.
- Exclude discarded ideas unless the user explicitly chose them.
- Do not include chain-of-thought.
- Output only the summary.`,
  artist: `You compress history into visual working memory for an image assistant.

Preserve:
- subject and composition
- visual style and references
- important prompt ingredients
- negative constraints
- model, workflow, LoRA, or generation choices that still matter
- what changed across iterations and what the user still wants adjusted

Rules:
- Use short structured sections.
- Keep only generation-relevant facts.
- Omit general chit-chat and internal reasoning.
- Output only the summary.`,
};

const getLmStudioChatUrl = () => {
  const rawBaseUrl = process.env.LM_STUDIO_BASE_URL;
  if (!rawBaseUrl) {
    throw new Error("LM_STUDIO_BASE_URL is not configured.");
  }

  const url = new URL(rawBaseUrl);
  url.pathname = "/api/v1/chat";
  return url.toString();
};

const getLmStudioHeaders = () => {
  return {
    "Content-Type": "application/json",
    ...(process.env.LM_STUDIO_TOKEN
      ? { Authorization: `Bearer ${process.env.LM_STUDIO_TOKEN}` }
      : {}),
  };
};

const formatMessagesForSummary = (messages: ThreadMessage[]) => {
  return messages
    .filter(
      (message) => !messagePartsContainContextCompactionMarker(message.content),
    )
    .map(
      (message) =>
        `${message.role.toUpperCase()}: ${formatMessageContentForPrompt(message.content)}`,
    )
    .join("\n\n");
};

const trimSummary = (summary: string, maxCharacters: number) => {
  const trimmed = summary.trim();
  if (trimmed.length <= maxCharacters) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxCharacters - 1).trimEnd()}...`;
};

const clipTranscript = (transcript: string, maxCharacters: number) => {
  const normalized = transcript.trim();
  if (normalized.length <= maxCharacters) {
    return normalized;
  }

  const clipped = normalized.slice(-maxCharacters).trimStart();
  return `[Older transcript omitted due length]\n\n${clipped}`;
};

const isContextOverflowText = (value: string | null | undefined) => {
  if (!value) {
    return false;
  }

  const normalized = value.toLowerCase();

  return (
    normalized.includes("context") &&
    (normalized.includes("overflow") ||
      normalized.includes("reached") ||
      normalized.includes("limit") ||
      normalized.includes("length"))
  );
};

const isContextOverflowSignal = ({
  stopReason,
  finishReason,
  errorMessage,
}: {
  stopReason?: string | null;
  finishReason?: string | null;
  errorMessage?: string | null;
}) => {
  return (
    stopReason === "context_length_reached" ||
    stopReason === "contextLengthReached" ||
    finishReason === "length" ||
    isContextOverflowText(stopReason) ||
    isContextOverflowText(finishReason) ||
    isContextOverflowText(errorMessage)
  );
};

const extractSummaryText = (
  output: Array<{ type: string; content?: string }> | undefined,
) => {
  return (output ?? [])
    .flatMap((item) =>
      item.type === "message" && typeof item.content === "string"
        ? [item.content.trim()]
        : [],
    )
    .filter(Boolean)
    .join("\n\n")
    .trim();
};

export const shouldRefreshConversationSummary = (
  thread: ThreadDetail,
  mode: PromptMode,
) => {
  const unsummarizedMessages = thread.messages.slice(
    thread.summaryMessageCount,
  );
  if (unsummarizedMessages.length < 2) {
    return false;
  }

  const config = summaryConfigByMode[mode];
  const unsummarizedCharacterCount = unsummarizedMessages.reduce(
    (total, message) =>
      total + formatMessageContentForPrompt(message.content).length,
    0,
  );

  return (
    unsummarizedMessages.length >= config.messageThreshold ||
    unsummarizedCharacterCount >= config.characterThreshold
  );
};

export const generateConversationSummary = async ({
  mode,
  modelInstanceId,
  previousSummary,
  messages,
  interruption,
}: {
  mode: PromptMode;
  modelInstanceId?: string | null;
  previousSummary: string | null;
  messages: ThreadMessage[];
  interruption?: {
    interrupted: boolean;
    interruptedAssistantTailChars?: string;
    interruptionContext?: string;
  };
}) => {
  if (!messages.length) {
    return previousSummary?.trim() ?? "";
  }

  const config = summaryConfigByMode[mode];
  const summaryContextLength =
    getConfiguredContextLengthForMode(mode, process.env) * 2;
  const strictCheckpointMode = mode === "fast" || mode === "regular";
  const model = await resolvePreferredLmStudioModelTarget({
    preferredInstanceId: modelInstanceId,
    modelKey: process.env.LM_STUDIO_MODEL!,
  });

  const requestSummary = async (transcript: string) => {
    const interruptionBlock = interruption?.interrupted
      ? [
          "Interruption metadata:",
          interruption.interruptionContext?.trim() ||
            "The previous assistant response was interrupted by context overflow.",
          ...(strictCheckpointMode
            ? [
                "When summarizing this interruption, include a strict continuation checkpoint:",
                "- current section/subsection currently in progress",
                "- completed items already emitted (exact names; deduplicated)",
                "- first next item that should be emitted after resume",
                "- forbidden repeats: items that must not appear again",
                "- short continuation contract: continue forward only, never restart from the beginning",
                "",
                "REQUIRED OUTPUT SHAPE for interruption summaries (must follow exactly):",
                "Goal: <one line>",
                "Format contract: <one line>",
                "Current section: <one line>",
                "Last completed item: <one line>",
                "Next expected item: <one line>",
                "Forbidden repeats: <comma-separated short keys>",
                "Compact enumerated list: <comma-separated keys or compact ranges>",
                "",
                "Rules for Compact enumerated list:",
                "- Base it on interrupted assistant output tail/full text as canonical source.",
                "- Include already emitted item keys (first-column identifiers).",
                "- If list is long, use compact ranges plus the most recent emitted keys.",
                "- Do not leave it empty when enumeration is detected.",
              ]
            : []),
          interruption.interruptedAssistantTailChars?.trim()
            ? `Interrupted assistant output tail:\n${interruption.interruptedAssistantTailChars.trim()}`
            : "Interrupted assistant output tail:\n(none)",
        ].join("\n")
      : null;

    const parts = [
      "Update the conversation summary using the new transcript.",
      "",
      previousSummary?.trim()
        ? `Existing summary:\n${previousSummary.trim()}`
        : "Existing summary:\n(none)",
      interruptionBlock ? `\n${interruptionBlock}` : "",
      "",
      `New transcript:\n${transcript}`,
    ].filter(Boolean);

    const response = await fetch(getLmStudioChatUrl(), {
      method: "POST",
      headers: getLmStudioHeaders(),
      body: JSON.stringify({
        model,
        context_length: summaryContextLength,
        input: parts.join("\n"),
        system_prompt: summaryPromptByMode[mode],
      }),
    });

    const data = (await response.json()) as {
      output?: Array<{ type: string; content?: string }>;
      stop_reason?: string;
      finish_reason?: string;
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new Error(
        data.error?.message ?? "LM Studio summary request failed.",
      );
    }

    const summary = extractSummaryText(data.output);
    console.log("Generated summary:", { summary, mode, interruption });
    const overflow = isContextOverflowSignal({
      stopReason: data.stop_reason,
      finishReason: data.finish_reason,
      errorMessage: data.error?.message,
    });

    return {
      summary,
      overflow,
    };
  };

  const fullTranscript = formatMessagesForSummary(messages);
  const primaryTranscript = clipTranscript(
    fullTranscript,
    config.maxTranscriptCharacters,
  );
  const primary = await requestSummary(primaryTranscript);

  if (primary.summary && !primary.overflow) {
    return trimSummary(primary.summary, config.maxSummaryCharacters);
  }

  const fallbackTranscript = clipTranscript(
    fullTranscript,
    Math.max(Math.floor(config.maxTranscriptCharacters / 2), 2_000),
  );
  const fallback = await requestSummary(fallbackTranscript);

  if (!fallback.summary) {
    throw new Error("LM Studio returned an empty conversation summary.");
  }

  return trimSummary(fallback.summary, config.maxSummaryCharacters);
};

export const buildFreshChainInput = ({
  summary,
  userInput,
}: {
  summary: string | null;
  userInput: string;
}) => {
  const trimmedSummary = summary?.trim();
  if (!trimmedSummary) {
    return userInput;
  }

  return [
    "Conversation summary:",
    trimmedSummary,
    "",
    "Continue the conversation naturally using the summary above.",
    "Current user message:",
    userInput,
  ].join("\n");
};
