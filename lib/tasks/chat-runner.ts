import {
  formatMessageContentForPrompt,
  getTextFromMessageContent,
  type MessagePart,
} from "@/lib/chat/message-content";
import { formatContextCompactionDuringRequestMarker } from "@/lib/chat/context-compaction-marker";
import { getStoredGeneration } from "@/lib/comfy/generations";
import { getGeneratedImagesForThread } from "@/lib/comfy/thread-generated-images";
import { getConfiguredContextLengthForMode } from "@/lib/lmstudio/context-length";
import { getMoodPromptById } from "@/lib/lmstudio/moods";
import {
  cleanupRedundantLmStudioModels,
  ensureLmStudioModelLoaded,
  formatLoadedLmStudioModelsForDebug,
  listLoadedLmStudioModels,
  resolvePreferredLmStudioModelTarget,
} from "@/lib/lmstudio/models";
import { generateThreadTitle } from "@/lib/lmstudio/title";
import {
  getThread,
  isPlaceholderThreadTitle,
  updateThread,
} from "@/lib/lmstudio/threads";
import {
  defaultPromptMode,
  isPromptMode,
  type PromptMode,
} from "@/lib/lmstudio/prompt-modes";
import { composeSystemPrompt } from "@/lib/lmstudio/prompts";
import {
  buildFreshChainInput,
  generateConversationSummary,
  shouldRefreshConversationSummary,
} from "@/lib/lmstudio/summaries";
import { processTaskQueues } from "@/lib/tasks/processor";
import {
  enqueueChatTask,
  hasPendingTitleGenerationTask,
  markTaskCompleted,
  markTaskFailed,
  setGroupTaskStatusByKind,
  transferTaskByKind,
  updateRunningTask,
} from "@/lib/tasks/scheduler";
import { getTask } from "@/lib/tasks/store";
import type { Task } from "@/lib/tasks/types";

type LmStudioOutput =
  | {
      type: "message";
      content: string;
    }
  | {
      type: "reasoning";
      content: string;
    }
  | {
      type: "invalid_tool_call";
      reason: string;
    };

type ChatResponse = {
  output?: LmStudioOutput[];
  response_id?: string;
  model_instance_id?: string;
  finish_reason?: string;
  stop_reason?: string;
  usage?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  model?: string;
  error?: {
    message?: string;
  };
};

const CONTEXT_COMPACT_THRESHOLD_RATIO = 0.9;
const MAX_OVERFLOW_CONTINUATIONS_PER_TASK = 8;
const MAX_CONTINUATION_PARTIAL_CHARS = 500;
const DEFAULT_ESTIMATED_IMAGE_TOKENS_PER_ATTACHMENT = 1024;

type PendingChatStream = {
  stream: ReadableStream<Uint8Array>;
  promptMode: PromptMode;
  requestedContextLength: number;
  modelTarget: string;
  summaryCallsInCurrentRequest: number;
};

declare global {
  var __comfyBridgePendingChatStreams:
    | Map<string, PendingChatStream>
    | undefined;
}

const getPendingChatStreams = () => {
  if (!globalThis.__comfyBridgePendingChatStreams) {
    globalThis.__comfyBridgePendingChatStreams = new Map();
  }
  return globalThis.__comfyBridgePendingChatStreams;
};

type ChatStreamEvent =
  | {
      type: "reasoning.delta";
      content: string;
    }
  | {
      type: "message.delta";
      content: string;
    }
  | {
      type: "error";
      error?: {
        message?: string;
      };
    }
  | {
      type: "chat.end";
      result: ChatResponse;
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

type LmStudioInputItem =
  | {
      type: "text";
      content: string;
    }
  | {
      type: "image";
      data_url: string;
    };

const unbiasedCritiqueSystemPrompt = [
  "You are an unbiased image quality auditor.",
  "You do not know any user intent or prompt.",
  "Given only an AI-generated image, find flaws, artifacts, and anatomical issues.",
  "Be concrete and technically specific.",
].join("\n");
const biasedCritiqueSystemPrompt = [
  "You are an image critique mentor.",
  "You receive: saved user intent, unbiased critique, image, and generation setup.",
  "Produce final critique with: intent mismatch, anatomical issues, graphical issues, and a corrected prompt suggestion.",
  "Only propose positivePrompt, negativePrompt, and LoRA usage suggestions. Do not alter cfg/steps/sampler/scheduler/seed.",
  "Treat LoRA changes as optional suggestions, not mandatory edits.",
  "Verify whether each currently used LoRA matches required image concepts.",
  "Concept match must be strict string equality after normalization (trim + lowercase), equivalent to JavaScript === on normalized strings.",
  "Do not use fuzzy logic, synonyms, semantic similarity, or partial overlap for LoRA concept matching.",
].join("\n");
const intentUpdateSystemPrompt = [
  "You maintain a compact persistent user intent profile for an ongoing conversation.",
  "Update intent using previous intent, previous assistant response, and latest user message.",
  "Keep it concise and practical for future guidance.",
  "Weight prior saved intent and latest user message equally.",
  "Preserve durable preferences from previous intent unless the latest message directly contradicts them.",
  "Output plain text only.",
  "Do not output JSON, markdown, bullet points, field labels, or code fences.",
  "Write exactly 2 short natural-language sentences.",
  "Sentence 1: stable carry-over intent from previous context.",
  "Sentence 2: latest update from the newest user message.",
].join("\n");

const critiqueAutoFollowupDisclaimer =
  "[Auto-generated from critique system message] Use the critique below to produce an improved generation action. Start directly with the improved image generation response.";

const composeCritiqueSystemPrompt = ({
  basePrompt,
  moodId,
}: {
  basePrompt: string;
  moodId: string | null;
}) => {
  const moodPrompt = getMoodPromptById(moodId);
  if (!moodPrompt) {
    return basePrompt;
  }

  return [
    basePrompt,
    "Use this mood overlay to influence your critiques:",
    moodPrompt,
  ].join("\n\n");
};

const getComfyMcpUrl = () => {
  const explicitUrl = process.env.COMFY_MCP_URL;
  if (explicitUrl) {
    return explicitUrl;
  }

  const port = process.env.COMFY_MCP_PORT ?? "4000";
  return `http://127.0.0.1:${port}/mcp`;
};

const getChatModelKey = () => {
  const modelKey = process.env.LM_STUDIO_MODEL;
  if (!modelKey) {
    throw new Error("LM_STUDIO_MODEL is not configured.");
  }

  return modelKey;
};

const isLmStudioModelDebugEnabled = () =>
  process.env.LM_STUDIO_DEBUG_MODEL_ROUTING === "true";

const TOOL_STREAM_LOG_PREVIEW_CHARS = 800;

const truncateForLog = (
  value: string,
  maxChars = TOOL_STREAM_LOG_PREVIEW_CHARS,
) => {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}... [truncated ${value.length - maxChars} chars]`;
};

const isLikelyToolStreamEvent = (
  eventType: string,
  data: Record<string, unknown>,
) => {
  const normalizedType = eventType.toLowerCase();
  if (normalizedType.includes("tool") || normalizedType.includes("mcp")) {
    return true;
  }

  const keys = Object.keys(data).map((key) => key.toLowerCase());
  return keys.some((key) => {
    return (
      key.includes("tool") ||
      key.includes("mcp") ||
      key.includes("call") ||
      key.includes("arguments") ||
      key.includes("result")
    );
  });
};

const logToolStreamEvent = ({
  taskId,
  threadId,
  eventType,
  data,
}: {
  taskId: string;
  threadId: string | null;
  eventType: string;
  data: Record<string, unknown>;
}) => {
  if (!isLikelyToolStreamEvent(eventType, data)) {
    return;
  }

  let serialized = "";
  try {
    serialized = JSON.stringify(data);
  } catch {
    serialized = "[unserializable payload]";
  }

  console.info("[chat-runner] stream:tool-event", {
    taskId,
    threadId,
    eventType,
    payloadKeys: Object.keys(data),
    payloadPreview: truncateForLog(serialized),
  });
};
const MAX_TOOL_EVENTS_FOR_INTERRUPTION = 24;
const MAX_TOOL_EVENT_PREVIEW_CHARS = 1_200;
const MAX_TOOL_TRANSCRIPT_CHARS = 20_000;

type ToolEventSnapshot = {
  eventType: string;
  payloadKeys: string[];
  payloadPreview: string;
};

const toToolEventSnapshot = (
  eventType: string,
  data: Record<string, unknown>,
): ToolEventSnapshot => {
  let serialized = "";
  try {
    serialized = JSON.stringify(data);
  } catch {
    serialized = "[unserializable payload]";
  }

  return {
    eventType,
    payloadKeys: Object.keys(data),
    payloadPreview: truncateForLog(serialized, MAX_TOOL_EVENT_PREVIEW_CHARS),
  };
};

const formatToolTranscriptForInterruption = (events: ToolEventSnapshot[]) => {
  if (!events.length) {
    return "";
  }

  const lines = events.map((event, index) => {
    const keys = event.payloadKeys.join(", ");
    return [
      `${index + 1}. ${event.eventType}`,
      `keys: ${keys || "(none)"}`,
      `payload: ${event.payloadPreview}`,
    ].join("\n");
  });

  return truncateForLog(lines.join("\n\n"), MAX_TOOL_TRANSCRIPT_CHARS);
};
const logChatModelDebug = (phase: string, payload: Record<string, unknown>) => {
  if (!isLmStudioModelDebugEnabled()) {
    return;
  }

  console.info(`[chat-runner] ${phase}`, payload);
};

const formatUnknownError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
    stack: null,
  };
};

const getAssistantText = (output: LmStudioOutput[] | undefined) => {
  if (!output?.length) return "";

  const text = output
    .flatMap((item) => (item.type === "message" ? [item.content.trim()] : []))
    .filter(Boolean)
    .join("\n\n");

  if (text) return text;

  const invalidToolCall = output.find(
    (item) => item.type === "invalid_tool_call",
  );
  if (invalidToolCall?.type === "invalid_tool_call") {
    return `Tool call failed: ${invalidToolCall.reason}`;
  }

  return "";
};

const tryParseJsonLikeText = (raw: string): unknown | null => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const codeFenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = codeFenceMatch ? codeFenceMatch[1].trim() : trimmed;
  if (!candidate) {
    return null;
  }

  const looksJson =
    (candidate.startsWith("{") && candidate.endsWith("}")) ||
    (candidate.startsWith("[") && candidate.endsWith("]"));
  if (!looksJson) {
    return null;
  }

  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
};

const collectJsonStringLeaves = (value: unknown): string[] => {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectJsonStringLeaves(item));
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((item) =>
      collectJsonStringLeaves(item),
    );
  }
  return [];
};

const ensureSentence = (value: string) => {
  const trimmed = value.trim().replace(/^[*-]\s+/, "");
  if (!trimmed) {
    return "";
  }
  if (/[.!?]$/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}.`;
};

const splitSentences = (text: string) => {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
};

const getFirstSentence = (text: string) => {
  const [first] = splitSentences(text);
  return first ?? text.trim();
};

const tokenizeForOverlap = (text: string) => {
  const stopwords = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "into",
    "your",
    "user",
    "intent",
    "image",
    "generation",
    "style",
    "make",
    "want",
    "wants",
  ]);

  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !stopwords.has(token)),
  );
};

const getTokenOverlapRatio = (a: string, b: string) => {
  const left = tokenizeForOverlap(a);
  const right = tokenizeForOverlap(b);
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let common = 0;
  for (const token of left) {
    if (right.has(token)) {
      common += 1;
    }
  }
  return common / Math.max(left.size, right.size);
};

const normalizeIntentToNaturalLanguage = (raw: string) => {
  const parsed = tryParseJsonLikeText(raw);
  if (!parsed) {
    return raw.trim();
  }

  const uniqueLeaves = [
    ...new Set(collectJsonStringLeaves(parsed).map((item) => item.trim())),
  ].filter((item) => item.length > 0);
  if (!uniqueLeaves.length) {
    return raw.trim();
  }

  return uniqueLeaves
    .map((item) => ensureSentence(item))
    .filter(Boolean)
    .join(" ");
};

const balanceIntentWithPrevious = ({
  previousIntent,
  nextIntent,
}: {
  previousIntent: string;
  nextIntent: string;
}) => {
  const previous = previousIntent.trim();
  const next = nextIntent.trim();

  if (!previous) {
    return next;
  }
  if (!next) {
    return previous;
  }

  const overlapRatio = getTokenOverlapRatio(previous, next);
  if (overlapRatio >= 0.4) {
    return next;
  }

  const priorSentence = ensureSentence(getFirstSentence(previous));
  const latestSentence = ensureSentence(getFirstSentence(next));

  const blended = [priorSentence, latestSentence].filter(Boolean).join(" ");
  return blended || next;
};

const getAssistantReasoning = (output: LmStudioOutput[] | undefined) => {
  if (!output?.length) return "";

  return output
    .flatMap((item) => (item.type === "reasoning" ? [item.content.trim()] : []))
    .filter(Boolean)
    .join("\n\n");
};

const requestLmStudioChat = async ({
  model,
  contextLength,
  input,
  systemPrompt,
  stream = false,
  integrations,
}: {
  model: string;
  contextLength: number;
  input: string | LmStudioInputItem[];
  systemPrompt: string;
  stream?: boolean;
  integrations?: ReturnType<typeof buildIntegrations>;
}) => {
  return fetch(getLmStudioChatUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.LM_STUDIO_TOKEN
        ? { Authorization: `Bearer ${process.env.LM_STUDIO_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      model,
      context_length: contextLength,
      input,
      system_prompt: systemPrompt,
      integrations: integrations ?? [],
      stream,
    }),
  });
};

const readTokenCount = (input: unknown) => {
  if (typeof input === "number" && Number.isFinite(input)) {
    return Math.max(0, Math.floor(input));
  }

  if (typeof input === "string") {
    const parsed = Number.parseInt(input, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return null;
};

const getUsedContextTokens = (response: ChatResponse | null) => {
  if (!response) {
    return null;
  }

  const usage = (response.usage ?? {}) as Record<string, unknown>;
  const stats = (response.stats ?? {}) as Record<string, unknown>;

  const inputTokens =
    readTokenCount(stats.input_tokens) ??
    readTokenCount(usage.input_tokens) ??
    readTokenCount(usage.prompt_tokens) ??
    readTokenCount(stats.prompt_tokens) ??
    readTokenCount(usage.promptTokensCount) ??
    readTokenCount(stats.promptTokensCount) ??
    null;
  const totalOutputTokens =
    readTokenCount(stats.total_output_tokens) ??
    readTokenCount(usage.total_output_tokens) ??
    readTokenCount(usage.output_tokens) ??
    readTokenCount(usage.completion_tokens) ??
    readTokenCount(stats.output_tokens) ??
    readTokenCount(stats.completion_tokens) ??
    readTokenCount(usage.predicted_tokens) ??
    readTokenCount(stats.predicted_tokens) ??
    readTokenCount(usage.generated_tokens) ??
    readTokenCount(stats.generated_tokens) ??
    readTokenCount(usage.predictedTokensCount) ??
    readTokenCount(stats.predictedTokensCount) ??
    null;

  if (inputTokens !== null && totalOutputTokens !== null) {
    return inputTokens + totalOutputTokens;
  }

  const totalTokens =
    readTokenCount(usage.total_tokens) ??
    readTokenCount(usage.totalTokens) ??
    readTokenCount(usage.totalTokensCount) ??
    readTokenCount(stats.total_tokens) ??
    readTokenCount(stats.totalTokens) ??
    readTokenCount(stats.totalTokensCount) ??
    null;
  if (totalTokens !== null) {
    return totalTokens;
  }

  return inputTokens;
};

const estimateMessageTokens = (message: MessagePart[]) => {
  const textLength = getTextFromMessageContent(message).length;
  return Math.ceil(textLength / 3.5);
};

const getEstimatedImageTokensPerAttachment = () => {
  const parsed = Number.parseInt(
    process.env.LM_STUDIO_ESTIMATED_IMAGE_TOKENS_PER_ATTACHMENT ??
      String(DEFAULT_ESTIMATED_IMAGE_TOKENS_PER_ATTACHMENT),
    10,
  );

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_ESTIMATED_IMAGE_TOKENS_PER_ATTACHMENT;
  }

  return parsed;
};

const estimateImageTokens = (parts: MessagePart[]) => {
  const imageCount = parts.filter((part) => part.type === "image").length;
  if (imageCount <= 0) {
    return 0;
  }
  return imageCount * getEstimatedImageTokensPerAttachment();
};

const shouldCompactForRatio = ({
  usedTokens,
  totalTokens,
}: {
  usedTokens: number | null;
  totalTokens: number;
}) => {
  if (usedTokens === null || totalTokens <= 0) {
    return false;
  }

  return usedTokens / totalTokens >= CONTEXT_COMPACT_THRESHOLD_RATIO;
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

const isLengthStopText = (value: string | null | undefined) => {
  if (!value) {
    return false;
  }

  const normalized = value.toLowerCase();
  return (
    normalized === "length" ||
    normalized === "max_predicted_tokens_reached" ||
    normalized === "maxpredictedtokensreached" ||
    (normalized.includes("max") && normalized.includes("token")) ||
    (normalized.includes("length") && normalized.includes("reached"))
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
    isLengthStopText(stopReason) ||
    isLengthStopText(finishReason) ||
    isContextOverflowText(stopReason) ||
    isContextOverflowText(finishReason) ||
    isContextOverflowText(errorMessage)
  );
};

const readStringField = (value: unknown) => {
  return typeof value === "string" ? value : null;
};

const getChatStopSignals = (response: ChatResponse | null) => {
  if (!response) {
    return {
      stopReason: null as string | null,
      finishReason: null as string | null,
    };
  }

  const stats = response.stats ?? {};
  const responseRecord = response as unknown as Record<string, unknown>;
  const stopReason =
    readStringField(response.stop_reason) ??
    readStringField(responseRecord.stopReason) ??
    readStringField((stats as Record<string, unknown>).stop_reason) ??
    readStringField((stats as Record<string, unknown>).stopReason) ??
    null;
  const finishReason =
    readStringField(response.finish_reason) ??
    readStringField(responseRecord.finishReason) ??
    readStringField((stats as Record<string, unknown>).finish_reason) ??
    readStringField((stats as Record<string, unknown>).finishReason) ??
    null;

  return {
    stopReason,
    finishReason,
  };
};

const collapseThreadContext = async ({
  threadId,
  promptMode,
  interruption,
}: {
  threadId: string;
  promptMode: PromptMode;
  interruption?: {
    interrupted: boolean;
    interruptedAssistantTailChars?: string;
    interruptedAssistantFullText?: string;
    interruptionContext?: string;
    toolEventsTranscript?: string;
  };
}) => {
  const thread = getThread(threadId);
  if (!thread) {
    return { collapsed: false as const, thread: null };
  }

  const unsummarizedMessages = thread.messages.slice(
    thread.summaryMessageCount,
  );
  if (!unsummarizedMessages.length) {
    return { collapsed: false as const, thread };
  }

  const interruptedAssistantFullText =
    interruption?.interruptedAssistantFullText?.trim() ?? "";
  const messagesForSummary = interruptedAssistantFullText
    ? [
        ...unsummarizedMessages,
        {
          role: "assistant" as const,
          content: [
            { type: "text" as const, text: interruptedAssistantFullText },
          ],
        },
      ]
    : unsummarizedMessages;

  const conversationSummary = await generateConversationSummary({
    mode: promptMode,
    modelInstanceId: thread.lmstudioModelInstanceId,
    previousSummary: thread.conversationSummary,
    messages: messagesForSummary,
    interruption,
  });

  const updatedThread = updateThread(thread.id, {
    conversationSummary,
    summaryUpdatedAt: new Date().toISOString(),
    summaryMessageCount: thread.messageCount,
    summaryCallCountTotal: thread.summaryCallCountTotal + 1,
    lmstudioResponseId: null,
    contextWindowUsedTokens: null,
  });

  return {
    collapsed: true as const,
    thread: updatedThread ?? getThread(thread.id),
  };
};

const maybeAutoCompactThreadContext = async ({
  threadId,
  taskId,
  promptMode,
  usedTokens,
  totalTokens,
  phase,
  continuationIndex,
  interruption,
  force = false,
}: {
  threadId: string;
  taskId: string;
  promptMode: PromptMode;
  usedTokens: number | null;
  totalTokens: number;
  phase: "before" | "after";
  continuationIndex: number;
  interruption?: {
    interrupted: boolean;
    interruptedAssistantTailChars?: string;
    interruptedAssistantFullText?: string;
    interruptionContext?: string;
    toolEventsTranscript?: string;
  };
  force?: boolean;
}) => {
  if (!force && !shouldCompactForRatio({ usedTokens, totalTokens })) {
    return {
      collapsed: false as const,
      thread: getThread(threadId),
    };
  }

  try {
    const result = await collapseThreadContext({
      threadId,
      promptMode,
      interruption,
    });

    if (result.collapsed) {
      console.info("[chat-runner] summary:triggered", {
        taskId,
        threadId,
        phase,
        continuationIndex,
      });
    }

    return result;
  } catch (error) {
    console.error("[chat-runner] summary:failed", {
      taskId,
      threadId,
      phase,
      continuationIndex,
      error,
    });
    return {
      collapsed: false as const,
      thread: getThread(threadId),
    };
  }
};

const buildIntegrations = (promptMode: PromptMode) => {
  const integrations: Array<{
    type: "ephemeral_mcp";
    server_label: "comfy" | "web_search" | "civitai";
    server_url: string;
  }> = [];

  if (
    (promptMode === "regular" || promptMode === "writer") &&
    process.env.WEB_SEARCH_MCP_ENABLED === "true" &&
    process.env.WEB_SEARCH_MCP_URL
  ) {
    integrations.push({
      type: "ephemeral_mcp",
      server_label: "web_search",
      server_url: process.env.WEB_SEARCH_MCP_URL,
    });
  }

  if (promptMode === "artist") {
    integrations.push({
      type: "ephemeral_mcp",
      server_label: "comfy",
      server_url: getComfyMcpUrl(),
    });

    if (
      process.env.CIVITAI_MCP_ENABLED === "true" &&
      process.env.CIVITAI_MCP_URL
    ) {
      integrations.push({
        type: "ephemeral_mcp",
        server_label: "civitai",
        server_url: process.env.CIVITAI_MCP_URL,
      });
    }
  }

  return integrations;
};

const parseSseEvents = async (
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
  onRawEvent?: (eventType: string, data: Record<string, unknown>) => void,
) => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const processEventBlock = (rawEventBlock: string) => {
    const lines = rawEventBlock.split(/\r?\n/);
    let eventType = "";
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        const dataValue = line.slice("data:".length);
        dataLines.push(
          dataValue.startsWith(" ") ? dataValue.slice(1) : dataValue,
        );
      }
    }

    if (!eventType || dataLines.length === 0) {
      return;
    }

    const data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
    onRawEvent?.(eventType, data);
    onEvent({
      type: eventType,
      ...(data as object),
    } as ChatStreamEvent);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const separatorMatch = /\r?\n\r?\n/.exec(buffer);
      if (!separatorMatch || separatorMatch.index === undefined) {
        break;
      }

      const separatorIndex = separatorMatch.index;
      const separatorLength = separatorMatch[0].length;

      const rawEventBlock = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + separatorLength);
      processEventBlock(rawEventBlock);
    }
  }

  const trailing = buffer.trim();
  if (trailing.length > 0) {
    processEventBlock(trailing);
  }
};

const isFailedStopText = (value: string | null | undefined) => {
  if (!value) {
    return false;
  }

  const normalized = value.toLowerCase();
  return normalized === "failed" || normalized.includes("fail");
};

const hasTaskByKind = (
  tasks:
    | Array<{
        id: string;
        kind: string;
      }>
    | undefined,
  kind: string,
) => {
  return tasks?.some((item) => item.kind === kind) ?? false;
};

const finalizeConversationViaStreamTask = ({
  taskId,
  text,
  reasoning,
  responseId,
  summaryCallsInCurrentRequest,
}: {
  taskId: string;
  text: string;
  reasoning: string;
  responseId: string | null;
  summaryCallsInCurrentRequest: number;
  delegatedToTaskGroupId?: string;
}) => {
  updateRunningTask(taskId, {
    result: {
      text,
      reasoning,
      responseId,
      summaryCallsInCurrentRequest,
    },
  });
  setGroupTaskStatusByKind({
    taskId,
    kind: "chat.stream",
    status: "completed",
  });
};

export const executeQueuedChatTask = async (
  taskId: string,
  taskKind: Task["kind"],
) => {
  const task = getTask(taskId);
  if (!task || task.type !== "chat") {
    return;
  }

  try {
    const groupTasks = task.payload.tasks ?? [];
    if (taskKind === "chat.title") {
      if (task.payload.kind !== "generate_title") {
        throw new Error("chat.title task requires generate_title payload.");
      }
      await executeQueuedTitleTask(task.id, task.payload.threadId);
      setGroupTaskStatusByKind({
        taskId: task.id,
        kind: "chat.title",
        status: "completed",
      });
      return;
    }

    if (taskKind === "chat.compact") {
      if (task.payload.kind !== "collapse_context") {
        throw new Error("chat.compact task requires collapse_context payload.");
      }
      await executeQueuedCollapseContextTask(
        task.id,
        task.payload.threadId,
        task.payload.promptMode,
        task.payload.interruption,
      );
      setGroupTaskStatusByKind({
        taskId: task.id,
        kind: "chat.compact",
        status: "completed",
      });
      return;
    }

    if (
      taskKind !== "chat.generate" &&
      taskKind !== "chat.intent" &&
      taskKind !== "chat.unbiased_critique" &&
      taskKind !== "chat.biased_critique" &&
      taskKind !== "chat.stream"
    ) {
      throw new Error(`Unsupported runnable chat task kind: ${taskKind}`);
    }
    if (
      task.payload.kind !== "conversation" &&
      task.payload.kind !== "critique" &&
      task.payload.kind !== "update_intent"
    ) {
      throw new Error("Unsupported payload kind for chat runnable task.");
    }
    if (task.payload.kind === "conversation") {
      if (!hasTaskByKind(groupTasks, "chat.generate")) {
        throw new Error("Missing chat.generate task.");
      }
      if (!hasTaskByKind(groupTasks, "chat.stream")) {
        throw new Error("Missing chat.stream task.");
      }
      if (
        taskKind === "chat.unbiased_critique" ||
        taskKind === "chat.biased_critique" ||
        taskKind === "chat.intent"
      ) {
        throw new Error("This task kind requires a non-conversation payload.");
      }
    } else if (task.payload.kind === "critique") {
      if (!hasTaskByKind(groupTasks, "chat.unbiased_critique")) {
        throw new Error("Missing chat.unbiased_critique task.");
      }
      if (!hasTaskByKind(groupTasks, "chat.biased_critique")) {
        throw new Error("Missing chat.biased_critique task.");
      }
      if (
        taskKind === "chat.generate" ||
        taskKind === "chat.stream" ||
        taskKind === "chat.intent"
      ) {
        throw new Error("This task kind requires a different payload.");
      }
    } else {
      if (!hasTaskByKind(groupTasks, "chat.intent")) {
        throw new Error("Missing chat.intent task.");
      }
      if (
        taskKind === "chat.generate" ||
        taskKind === "chat.stream" ||
        taskKind === "chat.unbiased_critique" ||
        taskKind === "chat.biased_critique"
      ) {
        throw new Error("This task kind requires a different payload.");
      }
    }
    let thread = task.payload.threadId
      ? getThread(task.payload.threadId)
      : null;
    const promptMode: PromptMode =
      task.payload.kind === "conversation"
        ? task.payload.promptMode && isPromptMode(task.payload.promptMode)
          ? task.payload.promptMode
          : defaultPromptMode
        : task.payload.kind === "critique"
          ? "artist"
          : "regular";
    const moodId =
      task.payload.kind === "conversation" || task.payload.kind === "critique"
        ? (task.payload.moodId ?? null)
        : null;
    const isPersistentConversation =
      task.payload.kind === "conversation"
        ? task.payload.persistent !== false
        : false;

    const shouldResetPromptState =
      taskKind === "chat.generate" &&
      isPersistentConversation &&
      thread !== null &&
      thread.lmstudioResponseId !== null &&
      (thread.lastPromptMode === null || thread.lastPromptMode !== promptMode);

    if (shouldResetPromptState && thread) {
      const updatedThread = updateThread(thread.id, {
        lmstudioResponseId: null,
        lastPromptMode: promptMode,
        conversationSummary: null,
        summaryUpdatedAt: null,
        summaryMessageCount: 0,
      });

      if (updatedThread) {
        thread = updatedThread;
      }
    }

    if (taskKind === "chat.generate") {
      const autoSummaryEnabled = process.env.LM_STUDIO_AUTO_SUMMARY === "true";

      if (
        autoSummaryEnabled &&
        isPersistentConversation &&
        thread &&
        shouldRefreshConversationSummary(thread, promptMode)
      ) {
        try {
          const unsummarizedMessages = thread.messages.slice(
            thread.summaryMessageCount,
          );
          const conversationSummary = await generateConversationSummary({
            mode: promptMode,
            modelInstanceId: thread.lmstudioModelInstanceId,
            previousSummary: thread.conversationSummary,
            messages: unsummarizedMessages,
          });

          const updatedThread = updateThread(thread.id, {
            conversationSummary,
            summaryUpdatedAt: new Date().toISOString(),
            summaryMessageCount: thread.messageCount,
            lmstudioResponseId: null,
          });

          if (updatedThread) {
            thread = updatedThread;
          }
        } catch (error) {
          console.error("[chat-runner] summary:failed", {
            taskId: task.id,
            threadId: task.payload.threadId ?? null,
            phase: "refresh",
            continuationIndex: 0,
            error,
          });
        }
      }
    }

    const requestedContextLength =
      typeof task.payload.contextLength === "number" &&
      Number.isFinite(task.payload.contextLength) &&
      task.payload.contextLength > 0
        ? Math.floor(task.payload.contextLength)
        : getConfiguredContextLengthForMode(promptMode, process.env);

    if (taskKind === "chat.intent") {
      if (task.payload.kind !== "update_intent") {
        throw new Error("chat.intent task requires update_intent payload.");
      }

      const intentThread = getThread(task.payload.threadId);
      if (!intentThread) {
        throw new Error("Intent update thread not found.");
      }

      const previousIntent = intentThread.userIntent ?? "";
      const previousAssistantText = [...intentThread.messages]
        .reverse()
        .find((message) => message.role === "assistant");
      const previousAssistantContent = previousAssistantText
        ? getTextFromMessageContent(previousAssistantText.content)
        : "";
      const latestUserMessage = getTextFromMessageContent(
        task.payload.userMessage,
      );

      const exactLoadedModel = await ensureLmStudioModelLoaded({
        modelKey: getChatModelKey(),
        contextLength: requestedContextLength,
      });
      const modelTarget = await resolvePreferredLmStudioModelTarget({
        preferredInstanceId: exactLoadedModel.instanceId,
        modelKey: getChatModelKey(),
      });

      const intentInput = [
        "Previous saved intent:",
        previousIntent || "(none)",
        "",
        "Previous assistant response:",
        previousAssistantContent || "(none)",
        "",
        "Latest user message:",
        latestUserMessage || "(empty)",
      ].join("\n");

      const response = await requestLmStudioChat({
        model: modelTarget,
        contextLength: requestedContextLength,
        input: intentInput,
        systemPrompt: intentUpdateSystemPrompt,
      });

      const data = (await response.json()) as ChatResponse;
      if (!response.ok) {
        throw new Error(data.error?.message ?? "Intent update request failed.");
      }

      const nextIntent = balanceIntentWithPrevious({
        previousIntent,
        nextIntent: normalizeIntentToNaturalLanguage(
          getAssistantText(data.output),
        ),
      });
      updateThread(task.payload.threadId, {
        userIntent: nextIntent || null,
      });

      updateRunningTask(task.id, {
        result: {
          text: nextIntent,
          reasoning: "",
          responseId: data.response_id ?? null,
          summaryCallsInCurrentRequest: 0,
        },
      });
      setGroupTaskStatusByKind({
        taskId: task.id,
        kind: "chat.intent",
        status: "completed",
      });
      return;
    }

    if (taskKind === "chat.unbiased_critique") {
      if (task.payload.kind !== "critique") {
        throw new Error(
          "chat.unbiased_critique task requires critique payload.",
        );
      }

      const exactLoadedModel = await ensureLmStudioModelLoaded({
        modelKey: getChatModelKey(),
        contextLength: requestedContextLength,
      });
      const modelTarget = await resolvePreferredLmStudioModelTarget({
        preferredInstanceId: exactLoadedModel.instanceId,
        modelKey: getChatModelKey(),
      });
      const unbiasedInput = buildUnbiasedCritiqueLmStudioInput({
        comfyTaskId: task.payload.comfyTaskId,
        imageIndex: task.payload.imageIndex,
      });
      const response = await requestLmStudioChat({
        model: modelTarget,
        contextLength: requestedContextLength,
        input: unbiasedInput,
        systemPrompt: composeCritiqueSystemPrompt({
          basePrompt: unbiasedCritiqueSystemPrompt,
          moodId,
        }),
      });
      const data = (await response.json()) as ChatResponse;
      if (!response.ok) {
        throw new Error(
          data.error?.message ?? "Unbiased critique request failed.",
        );
      }

      const unbiasedCritique = getAssistantText(data.output).trim();
      updateRunningTask(task.id, {
        result: {
          ...(task.result ?? {}),
          text: "",
          reasoning: "",
          responseId: data.response_id ?? null,
          summaryCallsInCurrentRequest: 0,
          unbiasedCritique,
        },
      });
      setGroupTaskStatusByKind({
        taskId: task.id,
        kind: "chat.unbiased_critique",
        status: "completed",
      });
      return;
    }

    if (taskKind === "chat.biased_critique") {
      if (task.payload.kind !== "critique") {
        throw new Error("chat.biased_critique task requires critique payload.");
      }

      const exactLoadedModel = await ensureLmStudioModelLoaded({
        modelKey: getChatModelKey(),
        contextLength: requestedContextLength,
      });
      const modelTarget = await resolvePreferredLmStudioModelTarget({
        preferredInstanceId: exactLoadedModel.instanceId,
        modelKey: getChatModelKey(),
      });
      const savedIntent = task.payload.threadId
        ? (getThread(task.payload.threadId)?.userIntent ?? "")
        : "";
      const biasedInput = buildBiasedCritiqueLmStudioInput({
        comfyTaskId: task.payload.comfyTaskId,
        imageIndex: task.payload.imageIndex,
        savedIntent,
        unbiasedCritique: task.result?.unbiasedCritique ?? "",
      });
      const response = await requestLmStudioChat({
        model: modelTarget,
        contextLength: requestedContextLength,
        input: biasedInput,
        systemPrompt: composeCritiqueSystemPrompt({
          basePrompt: biasedCritiqueSystemPrompt,
          moodId,
        }),
      });
      const data = (await response.json()) as ChatResponse;
      if (!response.ok) {
        throw new Error(
          data.error?.message ?? "Biased critique request failed.",
        );
      }

      const critiqueText = getAssistantText(data.output).trim();
      const critiqueReasoning = getAssistantReasoning(data.output).trim();
      let delegatedToTaskGroupId: string | undefined;

      if (task.payload.threadId) {
        const autoFollowupMessage = [
          critiqueAutoFollowupDisclaimer,
          [critiqueText, critiqueReasoning]
            .filter((value) => value.trim().length > 0)
            .join("\n\n") || "No critique text was generated.",
        ].join("\n\n");

        const autoFollowupTask = enqueueChatTask({
          kind: "conversation",
          threadId: task.payload.threadId,
          promptMode: "artist",
          moodId: null,
          contextLength: requestedContextLength,
          userMessage: [
            {
              type: "text",
              text: autoFollowupMessage,
            },
          ],
        });
        delegatedToTaskGroupId = autoFollowupTask.id;
      }

      updateRunningTask(task.id, {
        result: {
          ...(task.result ?? {}),
          text: critiqueText,
          reasoning: critiqueReasoning,
          responseId: data.response_id ?? null,
          summaryCallsInCurrentRequest: 0,
          delegatedToTaskGroupId,
        },
      });
      setGroupTaskStatusByKind({
        taskId: task.id,
        kind: "chat.biased_critique",
        status: "completed",
      });
      return;
    }

    let summaryCallsInCurrentRequest =
      task.payload.kind === "conversation" &&
      (task.payload.continuationIndex ?? 0) > 0
        ? (thread?.summaryCallsInCurrentRequest ?? 0)
        : 0;
    const setSummaryCallsInCurrentRequest = (value: number) => {
      summaryCallsInCurrentRequest = value;
      if (task.payload.kind === "conversation" && task.payload.threadId) {
        if (isPersistentConversation) {
          const updated = updateThread(task.payload.threadId, {
            summaryCallsInCurrentRequest,
          });
          if (updated) {
            thread = updated;
          }
        }
      }
    };

    if (
      taskKind === "chat.generate" &&
      task.payload.threadId &&
      task.payload.kind === "conversation" &&
      isPersistentConversation &&
      thread
    ) {
      const generatedImageLimitForEstimate = getAdaptiveGeneratedImageLimit({
        contextLength: requestedContextLength,
        userMessage: task.payload.userMessage,
      });
      const generatedImagesForEstimate = getGeneratedImagesForThread(
        thread.messages,
        generatedImageLimitForEstimate,
      );
      if ((task.payload.continuationIndex ?? 0) === 0) {
        setSummaryCallsInCurrentRequest(0);
      }
      const estimatedUpcomingTokens =
        estimateMessageTokens(task.payload.userMessage) +
        estimateImageTokens(generatedImagesForEstimate) +
        estimateImageTokens(task.payload.userMessage);
      const projectedUsedTokens =
        thread.contextWindowUsedTokens === null
          ? null
          : thread.contextWindowUsedTokens + estimatedUpcomingTokens;
      if (
        (task.payload.continuationIndex ?? 0) === 0 &&
        projectedUsedTokens !== null
      ) {
        const updated = updateThread(task.payload.threadId, {
          contextWindowUsedTokens: projectedUsedTokens,
          contextWindowTotalTokens: requestedContextLength,
        });
        if (updated) {
          thread = updated;
        }
      }
      if (
        shouldCompactForRatio({
          usedTokens: projectedUsedTokens,
          totalTokens: requestedContextLength,
        })
      ) {
        const compactTask = enqueueChatTask({
          kind: "collapse_context",
          threadId: task.payload.threadId,
          promptMode,
          moodId,
          contextLength: requestedContextLength * 2,
        });
        const continuationTask = enqueueChatTask({
          kind: "conversation",
          threadId: task.payload.threadId,
          promptMode,
          moodId,
          contextLength: requestedContextLength,
          userMessage: task.payload.userMessage,
          continuationIndex: task.payload.continuationIndex ?? 0,
          carryoverText: task.payload.carryoverText,
          carryoverReasoning: task.payload.carryoverReasoning,
          tasks: [
            {
              id: crypto.randomUUID(),
              kind: "chat.generate",
              status: "pending",
            },
          ],
        });
        if (hasTaskByKind(task.payload.tasks, "chat.stream")) {
          transferTaskByKind({
            fromTaskId: task.id,
            toTaskId: continuationTask.id,
            taskKind: "chat.stream",
            nextStatus: "pending",
          });
        }
        markTaskCompleted(task.id, {
          text: task.payload.carryoverText ?? "",
          reasoning: task.payload.carryoverReasoning ?? "",
          responseId: null,
          summaryCallsInCurrentRequest,
          delegatedToTaskGroupId: continuationTask.id,
        });
        console.info("[chat-runner] summary:triggered", {
          taskId: compactTask.id,
          threadId: task.payload.threadId,
          phase: "before",
          continuationIndex: task.payload.continuationIndex ?? 0,
        });
        return;
      }
    }

    let modelTarget = "";
    let userInput: string | LmStudioInputItem[] | null = null;

    if (taskKind === "chat.generate") {
      if (task.payload.kind !== "conversation") {
        throw new Error("chat.generate task requires conversation payload.");
      }
      const generatedImageLimit = getAdaptiveGeneratedImageLimit({
        contextLength: requestedContextLength,
        userMessage: task.payload.userMessage,
      });
      userInput = buildLmStudioInput({
        summary: thread?.conversationSummary ?? null,
        previousResponseId:
          (task.payload.continuationIndex ?? 0) > 0
            ? null
            : (thread?.lmstudioResponseId ?? null),
        generatedImages: thread
          ? getGeneratedImagesForThread(thread.messages, generatedImageLimit)
          : [],
        userMessage: task.payload.userMessage,
      });

      const exactLoadedModel = await ensureLmStudioModelLoaded({
        modelKey: getChatModelKey(),
        contextLength: requestedContextLength,
      });
      modelTarget = await resolvePreferredLmStudioModelTarget({
        preferredInstanceId:
          thread?.lmstudioModelInstanceId === exactLoadedModel.instanceId
            ? thread.lmstudioModelInstanceId
            : exactLoadedModel.instanceId,
        modelKey: getChatModelKey(),
      });
      const loadedBeforeRequest = await listLoadedLmStudioModels();

      logChatModelDebug("request:start", {
        taskId: task.id,
        kind: task.payload.kind,
        threadId: thread?.id ?? null,
        configuredModelKey: getChatModelKey(),
        preferredInstanceId: thread?.lmstudioModelInstanceId ?? null,
        selectedModelTarget: modelTarget,
        requestedContextLength,
        generatedImageLimit,
        previousResponseId: thread?.lmstudioResponseId ?? null,
        loadedModels: formatLoadedLmStudioModelsForDebug(loadedBeforeRequest),
      });
    } else {
      const pending = getPendingChatStreams().get(task.id);
      if (!pending) {
        throw new Error("chat.stream task has no pending stream.");
      }
      modelTarget = pending.modelTarget;
      summaryCallsInCurrentRequest = pending.summaryCallsInCurrentRequest;
    }

    let streamedText =
      task.payload.kind === "conversation"
        ? (task.payload.carryoverText ?? "")
        : "";
    let streamedReasoning =
      task.payload.kind === "conversation"
        ? (task.payload.carryoverReasoning ?? "")
        : "";
    const inRequestCompactionBreakOffsets: number[] = [];
    const publishRunningResult = (responseId: string | null) => {
      const displayText = applyCompactionMarkersToText(
        streamedText,
        inRequestCompactionBreakOffsets,
      );
      updateRunningTask(task.id, {
        result: {
          text: displayText,
          reasoning: streamedReasoning,
          responseId,
          summaryCallsInCurrentRequest,
        },
      });
    };
    publishRunningResult(null);

    const openChatGenerationStream = async ({
      input,
      previousResponseId,
      systemPrompt,
      integrations,
    }: {
      input: string | LmStudioInputItem[];
      previousResponseId?: string;
      systemPrompt?: string;
      integrations?: ReturnType<typeof buildIntegrations>;
    }) => {
      let response: Response;
      try {
        response = await fetch(getLmStudioChatUrl(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.LM_STUDIO_TOKEN
              ? { Authorization: `Bearer ${process.env.LM_STUDIO_TOKEN}` }
              : {}),
          },
          body: JSON.stringify({
            model: modelTarget,
            context_length: requestedContextLength,
            input,
            previous_response_id: previousResponseId,
            system_prompt:
              systemPrompt ??
              composeSystemPrompt({
                mode: promptMode,
                moodId,
              }),
            integrations: integrations ?? buildIntegrations(promptMode),
            stream: true,
          }),
        });
      } catch (error) {
        console.error("[chat-runner] generate:request-failed", {
          taskId: task.id,
          threadId: task.payload.threadId ?? null,
          selectedModelTarget: modelTarget,
          requestedContextLength,
          error: formatUnknownError(error),
        });
        throw error;
      }

      if (!response.ok) {
        const bodyText = await response.text();
        let data: ChatResponse | null = null;
        try {
          data = JSON.parse(bodyText) as ChatResponse;
        } catch {
          data = null;
        }

        console.error("[chat-runner] generate:non-2xx-response", {
          taskId: task.id,
          threadId: task.payload.threadId ?? null,
          status: response.status,
          selectedModelTarget: modelTarget,
          requestedContextLength,
          contentType: response.headers.get("content-type"),
          data,
          rawBody: bodyText,
        });
        throw new Error(
          data?.error?.message ||
            bodyText ||
            `LM Studio chat request failed: HTTP ${response.status}`,
        );
      }
      if (!response.body) {
        throw new Error("LM Studio did not return a stream body.");
      }

      return response.body;
    };

    const runChatStreamTask = async ({
      stream,
    }: {
      stream: ReadableStream<Uint8Array>;
    }): Promise<{
      overflowDetected: boolean;
      usedTokens: number | null;
      finalResponse: ChatResponse | null;
      toolEventsTranscript: string;
    }> => {
      let localStreamedText = "";
      let localStreamedReasoning = "";
      let localFinalResponse: ChatResponse | null = null;
      let localStreamErrorMessage: string | null = null;
      const localToolEvents: ToolEventSnapshot[] = [];

      try {
        await parseSseEvents(
          stream,
          (event) => {
            if (
              event.type === "reasoning.delta" &&
              typeof event.content === "string"
            ) {
              localStreamedReasoning += event.content;
              streamedReasoning += event.content;
              publishRunningResult(localFinalResponse?.response_id ?? null);
              return;
            }

            if (
              event.type === "message.delta" &&
              typeof event.content === "string"
            ) {
              localStreamedText += event.content;
              streamedText += event.content;
              publishRunningResult(localFinalResponse?.response_id ?? null);
              return;
            }

            if (event.type === "error") {
              console.error("[chat-runner] stream:error-event", {
                taskId: task.id,
                threadId: task.payload.threadId ?? null,
                selectedModelTarget: modelTarget,
                event,
              });
              throw new Error(
                event.error?.message ?? "LM Studio streaming error.",
              );
            }

            if (event.type === "chat.end") {
              localFinalResponse = event.result;
              const outputTypes = (event.result.output ?? []).map(
                (part) => part.type,
              );
              if (outputTypes.length > 0) {
                console.info("[chat-runner] stream:chat-end-output", {
                  taskId: task.id,
                  threadId: task.payload.threadId ?? null,
                  outputTypes,
                });
              }
              const signals = getChatStopSignals(event.result);
              logChatModelDebug("request:end", {
                taskId: task.id,
                threadId: thread?.id ?? null,
                selectedModelTarget: modelTarget,
                responseId: event.result.response_id ?? null,
                responseModelInstanceId: event.result.model_instance_id ?? null,
                stopReason: signals.stopReason,
                finishReason: signals.finishReason,
                usage: event.result.usage ?? null,
              });
            }
          },
          (eventType, data) => {
            logToolStreamEvent({
              taskId: task.id,
              threadId: task.payload.threadId ?? null,
              eventType,
              data,
            });

            if (isLikelyToolStreamEvent(eventType, data)) {
              localToolEvents.push(toToolEventSnapshot(eventType, data));
              if (localToolEvents.length > MAX_TOOL_EVENTS_FOR_INTERRUPTION) {
                localToolEvents.shift();
              }
            }
          },
        );
      } catch (error) {
        localStreamErrorMessage =
          error instanceof Error ? error.message : "LM Studio streaming error.";
      }

      const resolvedFinalResponse = localFinalResponse as ChatResponse | null;
      const localResponseOutput = resolvedFinalResponse?.output;
      const localResponseId = resolvedFinalResponse?.response_id ?? null;
      const localText =
        (localResponseOutput?.length
          ? getAssistantText(localResponseOutput)
          : "") || localStreamedText;
      const localReasoning =
        (localResponseOutput?.length
          ? getAssistantReasoning(localResponseOutput)
          : "") || localStreamedReasoning;
      const interruptedWithoutEnd =
        !resolvedFinalResponse &&
        (localStreamedText.trim().length > 0 ||
          localStreamedReasoning.trim().length > 0);
      const signals = getChatStopSignals(resolvedFinalResponse);
      const usedTokens = getUsedContextTokens(resolvedFinalResponse);
      const hasAnyAssistantOutput =
        localStreamedText.trim().length > 0 ||
        localStreamedReasoning.trim().length > 0 ||
        (localResponseOutput?.length ?? 0) > 0;
      const failedStopDetected =
        hasAnyAssistantOutput &&
        (isFailedStopText(signals.stopReason) ||
          isFailedStopText(signals.finishReason));
      const overflowDetected =
        interruptedWithoutEnd ||
        failedStopDetected ||
        isContextOverflowSignal({
          stopReason: signals.stopReason,
          finishReason: signals.finishReason,
          errorMessage: localStreamErrorMessage,
        });

      if (localStreamErrorMessage && !overflowDetected) {
        throw new Error(localStreamErrorMessage);
      }

      if (!localStreamedText && localText) {
        streamedText += localText;
      }
      if (!localStreamedReasoning && localReasoning) {
        streamedReasoning += localReasoning;
      }

      publishRunningResult(localResponseId);

      return {
        overflowDetected,
        usedTokens,
        finalResponse: resolvedFinalResponse,
        toolEventsTranscript:
          formatToolTranscriptForInterruption(localToolEvents),
      };
    };

    let initialAttempt: {
      overflowDetected: boolean;
      usedTokens: number | null;
      finalResponse: ChatResponse | null;
      toolEventsTranscript: string;
    } | null = null;

    if (taskKind === "chat.generate") {
      if (!userInput) {
        throw new Error(`${taskKind} task is missing input payload.`);
      }
      let stream: ReadableStream<Uint8Array>;
      try {
        if (task.payload.kind !== "conversation") {
          throw new Error("chat.generate task requires conversation payload.");
        }
        stream = await openChatGenerationStream({
          input: userInput,
          previousResponseId:
            (task.payload.continuationIndex ?? 0) > 0
              ? undefined
              : (thread?.lmstudioResponseId ?? undefined),
        });
      } catch (error) {
        console.error("[chat-runner] generate:open-stream-failed", {
          taskId: task.id,
          threadId: task.payload.threadId ?? null,
          selectedModelTarget: modelTarget,
          requestedContextLength,
          error: formatUnknownError(error),
        });
        throw error;
      }

      getPendingChatStreams().set(task.id, {
        stream,
        promptMode,
        requestedContextLength,
        modelTarget,
        summaryCallsInCurrentRequest,
      });
      setGroupTaskStatusByKind({
        taskId: task.id,
        kind: taskKind,
        status: "completed",
      });
      return;
    }

    const pendingStream = getPendingChatStreams().get(task.id);
    if (!pendingStream) {
      throw new Error("chat.stream task has no pending stream.");
    }
    try {
      initialAttempt = await runChatStreamTask({
        stream: pendingStream.stream,
      });
    } finally {
      getPendingChatStreams().delete(task.id);
    }

    const finalResponse: ChatResponse | null = initialAttempt.finalResponse;
    const overflowDetected = initialAttempt.overflowDetected;
    const nearLimitDetected =
      initialAttempt.usedTokens !== null &&
      initialAttempt.usedTokens >= requestedContextLength - 2;
    const continuationCount =
      task.payload.kind === "conversation"
        ? (task.payload.continuationIndex ?? 0)
        : 0;

    if (
      (overflowDetected || nearLimitDetected) &&
      task.payload.kind === "conversation" &&
      task.payload.threadId
    ) {
      if (continuationCount >= MAX_OVERFLOW_CONTINUATIONS_PER_TASK) {
        console.error("[chat-runner] reached continuation safety cap", {
          taskId: task.id,
          threadId: task.payload.threadId,
          continuationCount,
          usedTokens: getUsedContextTokens(finalResponse),
          totalTokens: requestedContextLength,
        });
      } else {
        const overflowSignals = getChatStopSignals(finalResponse);
        console.info("[chat-runner] overflow:detected", {
          taskId: task.id,
          threadId: task.payload.threadId,
          stopReason: overflowSignals.stopReason,
          finishReason: overflowSignals.finishReason,
          usedTokens: getUsedContextTokens(finalResponse),
          totalTokens: requestedContextLength,
          continuationIndex: continuationCount + 1,
          nearLimitDetected,
        });
        const nextContinuationIndex = continuationCount + 1;
        const breakOffset = streamedText.length;
        if (
          breakOffset > 0 &&
          (inRequestCompactionBreakOffsets.length === 0 ||
            inRequestCompactionBreakOffsets.at(-1) !== breakOffset)
        ) {
          inRequestCompactionBreakOffsets.push(breakOffset);
        }
        const interruptedAssistantTailChars =
          streamedText.length > MAX_CONTINUATION_PARTIAL_CHARS
            ? streamedText.slice(-MAX_CONTINUATION_PARTIAL_CHARS)
            : streamedText;

        const compactTask = enqueueChatTask({
          kind: "collapse_context",
          threadId: task.payload.threadId,
          promptMode,
          moodId,
          contextLength: requestedContextLength * 2,
          interruption: {
            interrupted: true,
            interruptedAssistantTailChars,
            interruptedAssistantFullText: streamedText,
            interruptionContext: overflowDetected
              ? "The assistant response was interrupted during generation near context limit. Resume from this checkpoint, continue forward only, and avoid repeating already emitted items."
              : "The assistant response reached context capacity and requires continuation. Resume from this checkpoint, continue forward only, and avoid repeating already emitted items.",
            toolEventsTranscript: initialAttempt?.toolEventsTranscript,
          },
        });
        const textWithCompactionMarkers = [
          streamedText,
          formatContextCompactionDuringRequestMarker(nextContinuationIndex),
        ]
          .filter(Boolean)
          .join("");

        const continuationTask = enqueueChatTask({
          kind: "conversation",
          threadId: task.payload.threadId,
          promptMode,
          moodId,
          persistent: task.payload.persistent,
          contextLength: requestedContextLength,
          userMessage: task.payload.userMessage,
          continuationIndex: nextContinuationIndex,
          carryoverText: textWithCompactionMarkers,
          carryoverReasoning: streamedReasoning,
          tasks: [
            {
              id: crypto.randomUUID(),
              kind: "chat.generate",
              status: "pending",
            },
          ],
        });
        if (hasTaskByKind(task.payload.tasks, "chat.stream")) {
          transferTaskByKind({
            fromTaskId: task.id,
            toTaskId: continuationTask.id,
            taskKind: "chat.stream",
            nextStatus: "pending",
          });
        }
        markTaskCompleted(task.id, {
          text: textWithCompactionMarkers,
          reasoning: streamedReasoning,
          responseId: finalResponse?.response_id ?? null,
          summaryCallsInCurrentRequest,
          delegatedToTaskGroupId: continuationTask.id,
        });
        console.info("[chat-runner] overflow:delegated", {
          sourceTaskGroupId: task.id,
          compactTaskGroupId: compactTask.id,
          continuationTaskGroupId: continuationTask.id,
          threadId: task.payload.threadId,
          continuationIndex: nextContinuationIndex,
        });
        console.info("[chat-runner] summary:triggered", {
          taskId: compactTask.id,
          threadId: task.payload.threadId,
          phase: "after",
          continuationIndex: nextContinuationIndex,
        });
        return;
      }
    }

    const text = streamedText;
    const reasoning = streamedReasoning;

    if (!text.trim() && !reasoning.trim()) {
      if (overflowDetected) {
        throw new Error(
          "LM Studio reached the context limit before generating output. Context was compacted but continuation produced no output.",
        );
      }
      throw new Error("LM Studio did not return any output.");
    }

    if (
      task.payload.kind === "conversation" &&
      task.payload.threadId &&
      task.payload.persistent !== false
    ) {
      const latestThread = getThread(task.payload.threadId);
      const lastMessage = latestThread?.messages.at(-1);
      const usedContextTokens = getUsedContextTokens(finalResponse);
      const textWithCompactionMarkers = applyCompactionMarkersToText(
        text,
        inRequestCompactionBreakOffsets,
      );

      const shouldAppendAssistantMessage =
        !lastMessage ||
        lastMessage.role !== "assistant" ||
        getTextFromMessageContent(lastMessage.content) !==
          textWithCompactionMarkers;
      const appendMessages = shouldAppendAssistantMessage
        ? [
            {
              role: "assistant" as const,
              content: [
                { type: "text" as const, text: textWithCompactionMarkers },
              ],
            },
          ]
        : undefined;

      const updatedThread = updateThread(task.payload.threadId, {
        lmstudioResponseId: finalResponse?.response_id ?? null,
        lmstudioModelInstanceId: finalResponse?.model_instance_id ?? null,
        lastPromptMode: promptMode,
        contextWindowUsedTokens: usedContextTokens,
        contextWindowTotalTokens: requestedContextLength,
        appendMessages,
      });

      if (
        task.payload.kind === "conversation" &&
        shouldCompactForRatio({
          usedTokens:
            usedContextTokens ?? updatedThread?.contextWindowUsedTokens ?? null,
          totalTokens: requestedContextLength,
        })
      ) {
        const compactTask = enqueueChatTask({
          kind: "collapse_context",
          threadId: task.payload.threadId,
          promptMode,
          moodId,
          contextLength: requestedContextLength * 2,
        });
        console.info("[chat-runner] summary:triggered", {
          taskId: compactTask.id,
          threadId: task.payload.threadId,
          phase: "after",
          continuationIndex: continuationCount + 1,
        });
      }
    }

    const finalTextWithMarkers = applyCompactionMarkersToText(
      text,
      inRequestCompactionBreakOffsets,
    );
    setGroupTaskStatusByKind({
      taskId: task.id,
      kind: "chat.stream",
      status: "completed",
    });
    finalizeConversationViaStreamTask({
      taskId: task.id,
      text: finalTextWithMarkers,
      reasoning,
      responseId: finalResponse?.response_id ?? null,
      summaryCallsInCurrentRequest,
    });

    if (
      task.payload.kind === "conversation" &&
      task.payload.threadId &&
      task.payload.persistent !== false
    ) {
      updateThread(task.payload.threadId, {
        summaryCallsInCurrentRequest: 0,
      });
      maybeEnqueueTitleGenerationTask(task.payload.threadId);
    }
  } catch (error) {
    console.error("[chat-runner] task:failed", {
      taskId: task.id,
      taskKind,
      threadId: task.payload.threadId ?? null,
      error: formatUnknownError(error),
    });

    if (task.payload.kind === "conversation") {
      if (taskKind === "chat.generate") {
        setGroupTaskStatusByKind({
          taskId: task.id,
          kind: "chat.generate",
          status: "failed",
        });
        setGroupTaskStatusByKind({
          taskId: task.id,
          kind: "chat.stream",
          status: "failed",
        });
      } else if (taskKind === "chat.stream") {
        setGroupTaskStatusByKind({
          taskId: task.id,
          kind: "chat.stream",
          status: "failed",
        });
      }
    }
    if (task.payload.kind === "critique") {
      if (taskKind === "chat.unbiased_critique") {
        setGroupTaskStatusByKind({
          taskId: task.id,
          kind: "chat.unbiased_critique",
          status: "failed",
        });
        setGroupTaskStatusByKind({
          taskId: task.id,
          kind: "chat.biased_critique",
          status: "failed",
        });
      } else if (taskKind === "chat.biased_critique") {
        setGroupTaskStatusByKind({
          taskId: task.id,
          kind: "chat.biased_critique",
          status: "failed",
        });
      }
    }
    if (task.payload.kind === "update_intent") {
      setGroupTaskStatusByKind({
        taskId: task.id,
        kind: "chat.intent",
        status: "failed",
      });
    }
    if (task.payload.kind === "collapse_context") {
      setGroupTaskStatusByKind({
        taskId: task.id,
        kind: "chat.compact",
        status: "failed",
      });
    }
    if (task.payload.kind === "generate_title") {
      setGroupTaskStatusByKind({
        taskId: task.id,
        kind: "chat.title",
        status: "failed",
      });
    }
    if (
      task.payload.kind === "conversation" &&
      task.payload.threadId &&
      task.payload.persistent !== false
    ) {
      updateThread(task.payload.threadId, {
        summaryCallsInCurrentRequest: 0,
      });
    }
    markTaskFailed(
      taskId,
      error instanceof Error ? error.message : "Chat task failed.",
    );
  } finally {
    try {
      const unloaded = await cleanupRedundantLmStudioModels({
        activeModelKey: getChatModelKey(),
      });
      const loadedAfterCleanup = await listLoadedLmStudioModels();

      logChatModelDebug("cleanup:after", {
        taskId,
        loadedModels: formatLoadedLmStudioModelsForDebug(loadedAfterCleanup),
        unloaded: formatLoadedLmStudioModelsForDebug(unloaded),
      });
    } catch (error) {
      console.error(
        "[chat-runner] failed to cleanup redundant LM Studio models",
        error,
      );
    }

    void processTaskQueues();
  }
};

const executeQueuedTitleTask = async (taskId: string, threadId: string) => {
  const thread = getThread(threadId);
  if (!thread) {
    throw new Error("Thread not found.");
  }

  if (thread.titleGenerated && !isPlaceholderThreadTitle(thread.title)) {
    updateRunningTask(taskId, {
      result: {
        title: thread.title,
      },
    });
    return;
  }

  const inferredTitle = await generateThreadTitle(thread);
  const nextTitle = inferredTitle || thread.title || "New Chat";
  const updatedThread = updateThread(threadId, {
    title: nextTitle,
    titleGenerated: !isPlaceholderThreadTitle(nextTitle),
  });

  updateRunningTask(taskId, {
    result: {
      title: updatedThread?.title ?? nextTitle,
    },
  });
};

const executeQueuedCollapseContextTask = async (
  taskId: string,
  threadId: string,
  promptMode: string,
  interruption?: {
    interrupted: boolean;
    interruptedAssistantTailChars?: string;
    interruptedAssistantFullText?: string;
    interruptionContext?: string;
    toolEventsTranscript?: string;
  },
) => {
  const thread = getThread(threadId);
  if (!thread) {
    throw new Error("Thread not found.");
  }

  if (!isPromptMode(promptMode)) {
    throw new Error("A valid promptMode is required.");
  }
  const result = await collapseThreadContext({
    threadId,
    promptMode,
    interruption,
  });

  if (result.collapsed && interruption?.interrupted) {
    const latestThread = getThread(threadId);
    if (latestThread) {
      updateThread(threadId, {
        summaryCallsInCurrentRequest:
          (latestThread.summaryCallsInCurrentRequest ?? 0) + 1,
      });
    }
  }

  updateRunningTask(taskId, {
    result: {
      summaryCollapsed: result.collapsed,
    },
  });
};

const buildLmStudioInput = ({
  summary,
  previousResponseId,
  generatedImages,
  userMessage,
}: {
  summary: string | null;
  previousResponseId: string | null;
  generatedImages: MessagePart[];
  userMessage: MessagePart[];
}): string | LmStudioInputItem[] => {
  const imageParts = [
    ...generatedImages.filter(
      (part): part is Extract<MessagePart, { type: "image" }> =>
        part.type === "image",
    ),
    ...userMessage.filter(
      (part): part is Extract<MessagePart, { type: "image" }> =>
        part.type === "image",
    ),
  ];

  if (previousResponseId) {
    return toLmStudioInputItems(userMessage, imageParts);
  }

  const text = buildFreshChainInput({
    summary,
    userInput: getTextFromMessageContent(userMessage),
  });

  if (!imageParts.length) {
    return text;
  }

  return [
    {
      type: "text",
      content: [
        text,
        generatedImages.length
          ? "Use the attached image(s), including recent generated results from this conversation, together with the user request."
          : "Use the attached image(s) together with the user request.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
    ...imageParts.map((part) => ({
      type: "image" as const,
      data_url: part.dataUrl,
    })),
  ];
};

const toLmStudioInputItems = (
  parts: MessagePart[],
  imageParts: Extract<MessagePart, { type: "image" }>[],
): LmStudioInputItem[] => {
  const text = getTextFromMessageContent(parts).trim();

  const items: LmStudioInputItem[] = [];

  if (text) {
    items.push({
      type: "text",
      content: text,
    });
  }

  items.push(
    ...imageParts.map((part) => ({
      type: "image" as const,
      data_url: part.dataUrl,
    })),
  );

  if (!items.length) {
    items.push({
      type: "text",
      content: formatMessageContentForPrompt(parts),
    });
  }

  return items;
};

const getCritiqueSourceData = ({
  comfyTaskId,
  imageIndex,
}: {
  comfyTaskId: string;
  imageIndex: number;
}) => {
  const comfyTask = getTask(comfyTaskId);
  if (!comfyTask || comfyTask.type !== "comfy") {
    throw new Error("Critique source comfy task not found.");
  }

  const jobId = comfyTask.result?.jobId ?? null;
  if (!jobId) {
    throw new Error("Critique source task has no generation job id.");
  }

  const generation = getStoredGeneration(jobId);
  if (!generation || generation.status !== "completed") {
    throw new Error("Critique source generation is not completed.");
  }

  const image = generation.images[imageIndex];
  if (!image) {
    throw new Error("Critique source image index is out of range.");
  }

  return { comfyTask, image };
};

const buildUnbiasedCritiqueLmStudioInput = ({
  comfyTaskId,
  imageIndex,
}: {
  comfyTaskId: string;
  imageIndex: number;
}): LmStudioInputItem[] => {
  const { image } = getCritiqueSourceData({ comfyTaskId, imageIndex });

  return [
    {
      type: "text",
      content: [
        "Audit this AI-generated image without any prompt/context.",
        "Return sections:",
        "1) Anatomical issues",
        "2) Graphical/rendering issues",
        "3) Composition/lighting issues",
        "4) Realism/style consistency issues",
      ].join("\n"),
    },
    {
      type: "image",
      data_url: `data:${image.mimeType};base64,${image.data}`,
    },
  ];
};

const buildBiasedCritiqueLmStudioInput = ({
  comfyTaskId,
  imageIndex,
  savedIntent,
  unbiasedCritique,
}: {
  comfyTaskId: string;
  imageIndex: number;
  savedIntent: string;
  unbiasedCritique: string;
}): LmStudioInputItem[] => {
  const { comfyTask, image } = getCritiqueSourceData({
    comfyTaskId,
    imageIndex,
  });

  const critiqueInputText = [
    "Saved user intent:",
    savedIntent.trim() || "(not available)",
    "",
    "Unbiased critique (image-only):",
    unbiasedCritique.trim() || "(not available)",
    "",
    "Generation setup to evaluate against:",
    JSON.stringify(
      {
        positivePrompt: comfyTask.payload.prompt,
        negativePrompt: comfyTask.payload.negativePrompt,
        loras: comfyTask.payload.loras,
      },
      null,
      2,
    ),
    "",
    "Return sections:",
    "1) Summary",
    "2) Intent mismatch bullets",
    "3) Anatomical issues bullets",
    "4) Graphical issues bullets",
    "5) Corrected positivePrompt",
    "6) Corrected negativePrompt",
    "7) LoRA concept match checks (strict equality only)",
    "8) Suggested LoRA usage (optional)",
  ].join("\n");

  return [
    {
      type: "text",
      content: critiqueInputText,
    },
    {
      type: "image",
      data_url: `data:${image.mimeType};base64,${image.data}`,
    },
  ];
};

const applyCompactionMarkersToText = (text: string, breakOffsets: number[]) => {
  if (!text || breakOffsets.length === 0) {
    return text;
  }

  const validBreakOffsets = Array.from(
    new Set(
      breakOffsets.filter((offset) => offset > 0 && offset < text.length),
    ),
  ).sort((left, right) => left - right);

  if (!validBreakOffsets.length) {
    return text;
  }

  let combinedText = text;
  for (let index = validBreakOffsets.length - 1; index >= 0; index -= 1) {
    const breakOffset = validBreakOffsets[index];
    const marker = formatContextCompactionDuringRequestMarker(index + 1);
    combinedText =
      combinedText.slice(0, breakOffset) +
      marker +
      combinedText.slice(breakOffset);
  }

  return combinedText;
};

const estimateRemainingContextRatio = ({
  contextLength,
  userMessage,
}: {
  contextLength: number;
  userMessage: MessagePart[];
}) => {
  const messageTextLength = getTextFromMessageContent(userMessage).length;
  const estimatedUsedTokens = Math.ceil(messageTextLength / 3.5);
  const remaining = Math.max(0, contextLength - estimatedUsedTokens);

  return remaining / Math.max(contextLength, 1);
};

const getAdaptiveGeneratedImageLimit = ({
  contextLength,
  userMessage,
}: {
  contextLength: number;
  userMessage: MessagePart[];
}) => {
  const remainingRatio = estimateRemainingContextRatio({
    contextLength,
    userMessage,
  });

  if (remainingRatio < 0.25) {
    return 1;
  }

  if (remainingRatio < 0.5) {
    return 2;
  }

  return 3;
};

const maybeEnqueueTitleGenerationTask = (threadId: string) => {
  const thread = getThread(threadId);
  if (!thread) {
    return;
  }

  if (thread.titleGenerated && !isPlaceholderThreadTitle(thread.title)) {
    return;
  }

  if (hasPendingTitleGenerationTask(threadId)) {
    return;
  }

  enqueueChatTask({
    kind: "generate_title",
    threadId,
    contextLength: getConfiguredContextLengthForMode(
      thread.lastPromptMode && isPromptMode(thread.lastPromptMode)
        ? thread.lastPromptMode
        : defaultPromptMode,
      process.env,
    ),
  });
};
