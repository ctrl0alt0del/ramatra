import "server-only";

import { type ThreadDetail, type ThreadMessage } from "@/lib/lmstudio/threads";

import { type PromptMode } from "./prompt-modes";

type SummaryConfig = {
  messageThreshold: number;
  characterThreshold: number;
  maxSummaryCharacters: number;
};

const summaryConfigByMode: Record<PromptMode, SummaryConfig> = {
  fast: {
    messageThreshold: 8,
    characterThreshold: 5_000,
    maxSummaryCharacters: 1_500,
  },
  regular: {
    messageThreshold: 10,
    characterThreshold: 7_500,
    maxSummaryCharacters: 2_400,
  },
  writer: {
    messageThreshold: 8,
    characterThreshold: 9_000,
    maxSummaryCharacters: 4_500,
  },
  artist: {
    messageThreshold: 8,
    characterThreshold: 6_000,
    maxSummaryCharacters: 2_800,
  },
};

const summaryPromptByMode: Record<PromptMode, string> = {
  fast: `You compress chat history into tiny working memory for a fast assistant.

Goal:
- Produce the smallest useful summary possible.

Keep only:
- current user goal
- constraints
- critical established facts
- unresolved question or next step

Rules:
- Use short bullet points.
- Omit fluff, examples, repeated wording, and long explanations.
- Do not include reasoning traces.
- Do not mention tools unless the result matters to the next reply.
- Output only the summary.`,
  regular: `You compress chat history into practical working memory for a general assistant.

Keep:
- user goals
- important facts
- preferences
- relevant tool findings in compressed form
- open tasks or unresolved questions

Rules:
- Prefer concise bullets with short section headers.
- Remove repetition and low-value conversational filler.
- Do not include chain-of-thought or internal reasoning.
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
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");
};

const trimSummary = (summary: string, maxCharacters: number) => {
  const trimmed = summary.trim();
  if (trimmed.length <= maxCharacters) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxCharacters - 1).trimEnd()}...`;
};

export const shouldRefreshConversationSummary = (
  thread: ThreadDetail,
  mode: PromptMode,
) => {
  const unsummarizedMessages = thread.messages.slice(thread.summaryMessageCount);
  if (unsummarizedMessages.length < 2) {
    return false;
  }

  const config = summaryConfigByMode[mode];
  const unsummarizedCharacterCount = unsummarizedMessages.reduce(
    (total, message) => total + message.content.length,
    0,
  );

  return (
    unsummarizedMessages.length >= config.messageThreshold ||
    unsummarizedCharacterCount >= config.characterThreshold
  );
};

export const generateConversationSummary = async ({
  mode,
  previousSummary,
  messages,
}: {
  mode: PromptMode;
  previousSummary: string | null;
  messages: ThreadMessage[];
}) => {
  if (!messages.length) {
    return previousSummary?.trim() ?? "";
  }

  const config = summaryConfigByMode[mode];
  const parts = [
    "Update the conversation summary using the new transcript.",
    "",
    previousSummary?.trim()
      ? `Existing summary:\n${previousSummary.trim()}`
      : "Existing summary:\n(none)",
    "",
    `New transcript:\n${formatMessagesForSummary(messages)}`,
  ];

  const response = await fetch(getLmStudioChatUrl(), {
    method: "POST",
    headers: getLmStudioHeaders(),
    body: JSON.stringify({
      model: process.env.LM_STUDIO_MODEL,
      input: parts.join("\n"),
      system_prompt: summaryPromptByMode[mode],
    }),
  });

  const data = (await response.json()) as {
    output?: Array<{ type: string; content?: string }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(
      data.error?.message ?? "LM Studio summary request failed.",
    );
  }

  const summary = (data.output ?? [])
    .flatMap((item) =>
      item.type === "message" && typeof item.content === "string"
        ? [item.content.trim()]
        : [],
    )
    .filter(Boolean)
    .join("\n\n");

  return trimSummary(summary || previousSummary || "", config.maxSummaryCharacters);
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
