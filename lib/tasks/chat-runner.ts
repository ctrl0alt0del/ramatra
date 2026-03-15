import {
  formatMessageContentForPrompt,
  getTextFromMessageContent,
  type MessagePart,
} from "@/lib/chat/message-content";
import { formatContextCompactionDuringRequestMarker } from "@/lib/chat/context-compaction-marker";
import { getStoredGeneration } from "@/lib/comfy/generations";
import { getGeneratedImagesForThread } from "@/lib/comfy/thread-generated-images";
import { getConfiguredContextLengthForMode } from "@/lib/lmstudio/context-length";
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

const critiqueSystemPrompt = [
  "You are an experienced art critique mentor.",
  "Compare the user intent with the generated image.",
  "Treat the generated image as incorrect by default and explain why.",
  "List intent mismatch, anatomical issues, and graphical issues.",
  "Then provide corrected prompt and generation settings for the artist model.",
].join("\n");

const critiqueAutoFollowupDisclaimer =
  "[Auto-generated from critique system message] Use the critique below to produce an improved generation action. Start directly with the improved image generation response.";

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

const truncateForLog = (value: string, maxChars = TOOL_STREAM_LOG_PREVIEW_CHARS) => {
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

const getAssistantReasoning = (output: LmStudioOutput[] | undefined) => {
  if (!output?.length) return "";

  return output
    .flatMap((item) => (item.type === "reasoning" ? [item.content.trim()] : []))
    .filter(Boolean)
    .join("\n\n");
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
  delegatedToTaskGroupId,
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
      delegatedToTaskGroupId,
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
      taskKind !== "chat.critique" &&
      taskKind !== "chat.stream"
    ) {
      throw new Error(`Unsupported runnable chat task kind: ${taskKind}`);
    }
    if (task.payload.kind !== "conversation" && task.payload.kind !== "critique") {
      throw new Error("Unsupported payload kind for chat runnable task.");
    }
    if (task.payload.kind === "conversation") {
      if (!hasTaskByKind(groupTasks, "chat.generate")) {
        throw new Error("Missing chat.generate task.");
      }
      if (!hasTaskByKind(groupTasks, "chat.stream")) {
        throw new Error("Missing chat.stream task.");
      }
      if (taskKind === "chat.critique") {
        throw new Error("chat.critique task requires critique payload.");
      }
    } else {
      if (!hasTaskByKind(groupTasks, "chat.critique")) {
        throw new Error("Missing chat.critique task.");
      }
      if (!hasTaskByKind(groupTasks, "chat.stream")) {
        throw new Error("Missing chat.stream task.");
      }
      if (taskKind === "chat.generate") {
        throw new Error("chat.generate task requires conversation payload.");
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
        : "artist";
    const moodId =
      task.payload.kind === "conversation"
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

    if (taskKind === "chat.generate" || taskKind === "chat.critique") {
      const generatedImageLimit = getAdaptiveGeneratedImageLimit({
        contextLength: requestedContextLength,
        userMessage:
          task.payload.kind === "conversation"
            ? task.payload.userMessage
            : [{ type: "text", text: "Image critique request" }],
      });
      if (taskKind === "chat.generate") {
        if (task.payload.kind !== "conversation") {
          throw new Error("chat.generate task requires conversation payload.");
        }
        userInput = buildLmStudioInput({
          summary: thread?.conversationSummary ?? null,
          previousResponseId:
            (task.payload.continuationIndex ?? 0) > 0
              ? null
              : (thread?.lmstudioResponseId ?? null),
          generatedImages:
            thread
              ? getGeneratedImagesForThread(thread.messages, generatedImageLimit)
              : [],
          userMessage: task.payload.userMessage,
        });
      } else {
        if (task.payload.kind !== "critique") {
          throw new Error("chat.critique task requires critique payload.");
        }
        userInput = buildCritiqueLmStudioInput({
          comfyTaskId: task.payload.comfyTaskId,
          imageIndex: task.payload.imageIndex,
        });
      }

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
              const outputTypes = (event.result.output ?? []).map((part) => part.type);
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
        toolEventsTranscript: formatToolTranscriptForInterruption(localToolEvents),
      };
    };

    let initialAttempt:
      | {
          overflowDetected: boolean;
          usedTokens: number | null;
          finalResponse: ChatResponse | null;
          toolEventsTranscript: string;
        }
      | null = null;

    if (taskKind === "chat.generate" || taskKind === "chat.critique") {
      if (!userInput) {
        throw new Error(`${taskKind} task is missing input payload.`);
      }
      let stream: ReadableStream<Uint8Array>;
      try {
        if (taskKind === "chat.generate") {
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
        } else {
          stream = await openChatGenerationStream({
            input: userInput,
            systemPrompt: critiqueSystemPrompt,
            integrations: [],
          });
        }
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
          interruptionContext:
            overflowDetected
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
    let delegatedToTaskGroupId: string | undefined;

    if (task.payload.kind === "critique" && task.payload.threadId) {
      const critiqueBody = [finalTextWithMarkers, reasoning]
        .filter((value) => value.trim().length > 0)
        .join("\n\n");
      const autoFollowupMessage = [
        critiqueAutoFollowupDisclaimer,
        critiqueBody || "No critique text was generated.",
      ].join("\n\n");

      const autoFollowupTask = enqueueChatTask({
        kind: "conversation",
        threadId: task.payload.threadId ?? null,
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

    finalizeConversationViaStreamTask({
      taskId: task.id,
      text: finalTextWithMarkers,
      reasoning,
      responseId: finalResponse?.response_id ?? null,
      summaryCallsInCurrentRequest,
      delegatedToTaskGroupId,
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
      if (taskKind === "chat.critique") {
        setGroupTaskStatusByKind({
          taskId: task.id,
          kind: "chat.critique",
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

const buildCritiqueLmStudioInput = ({
  comfyTaskId,
  imageIndex,
}: {
  comfyTaskId: string;
  imageIndex: number;
}): LmStudioInputItem[] => {
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

  const critiqueInputText = [
    "User original intent:",
    comfyTask.payload.sourceUserIntent?.trim() || "(not available)",
    "",
    "What was requested for generation:",
    comfyTask.payload.prompt.trim(),
    "",
    "Generation parameters:",
    JSON.stringify(
      {
        workflowName: comfyTask.payload.workflowName,
        prompt: comfyTask.payload.prompt,
        negativePrompt: comfyTask.payload.negativePrompt,
        inputImage: comfyTask.payload.inputImage,
        width: comfyTask.payload.width,
        height: comfyTask.payload.height,
        steps: comfyTask.payload.steps,
        cfg: comfyTask.payload.cfg,
        seed: comfyTask.payload.seed,
        samplerName: comfyTask.payload.samplerName,
        scheduler: comfyTask.payload.scheduler,
        loras: comfyTask.payload.loras,
      },
      null,
      2,
    ),
    "",
    "Output format (strict):",
    "1) Summary",
    "2) Intent mismatch bullets",
    "3) Anatomical issues bullets",
    "4) Graphical issues bullets",
    "5) Corrected prompt",
    "6) Corrected generation parameters as compact JSON",
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
























