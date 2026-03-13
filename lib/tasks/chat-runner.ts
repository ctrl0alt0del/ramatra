import {
  formatMessageContentForPrompt,
  getTextFromMessageContent,
  type MessagePart,
} from "@/lib/chat/message-content";
import { formatContextCompactionDuringRequestMarker } from "@/lib/chat/context-compaction-marker";
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
import { getSystemPromptForMode } from "@/lib/lmstudio/prompts";
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
  markTaskStarted,
  updateRunningTask,
} from "@/lib/tasks/scheduler";

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

const logChatModelDebug = (phase: string, payload: Record<string, unknown>) => {
  if (!isLmStudioModelDebugEnabled()) {
    return;
  }

  console.info(`[chat-runner] ${phase}`, payload);
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
        dataLines.push(line.slice("data:".length).trim());
      }
    }

    if (!eventType || dataLines.length === 0) {
      return;
    }

    const data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
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
      const separatorIndex = buffer.indexOf("\n\n");
      if (separatorIndex === -1) break;

      const rawEventBlock = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      processEventBlock(rawEventBlock);
    }
  }

  const trailing = buffer.trim();
  if (trailing.length > 0) {
    processEventBlock(trailing);
  }
};

export const executeQueuedChatTask = async (taskId: string) => {
  const task = markTaskStarted(taskId);
  if (!task || task.type !== "chat") {
    return;
  }

  try {
    if (task.payload.kind === "generate_title") {
      await executeQueuedTitleTask(task.id, task.payload.threadId);
      return;
    }

    if (task.payload.kind === "collapse_context") {
      await executeQueuedCollapseContextTask(
        task.id,
        task.payload.threadId,
        task.payload.promptMode,
      );
      return;
    }

    let thread = task.payload.threadId
      ? getThread(task.payload.threadId)
      : null;
    const promptMode =
      task.payload.promptMode && isPromptMode(task.payload.promptMode)
        ? task.payload.promptMode
        : defaultPromptMode;

    const shouldResetPromptState =
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

    const autoSummaryEnabled = process.env.LM_STUDIO_AUTO_SUMMARY === "true";

    if (
      autoSummaryEnabled &&
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

    const requestedContextLength = getConfiguredContextLengthForMode(
      promptMode,
      process.env,
    );

    let summaryCallsInCurrentRequest = 0;
    const setSummaryCallsInCurrentRequest = (value: number) => {
      summaryCallsInCurrentRequest = value;
      if (task.payload.kind === "conversation" && task.payload.threadId) {
        const updated = updateThread(task.payload.threadId, {
          summaryCallsInCurrentRequest,
        });
        if (updated) {
          thread = updated;
        }
      }
    };

    if (
      task.payload.threadId &&
      task.payload.kind === "conversation" &&
      thread
    ) {
      setSummaryCallsInCurrentRequest(0);
      const estimatedUpcomingTokens = estimateMessageTokens(
        task.payload.userMessage,
      );
      const projectedUsedTokens =
        thread.contextWindowUsedTokens === null
          ? null
          : thread.contextWindowUsedTokens + estimatedUpcomingTokens;

      const maybeCompacted = await maybeAutoCompactThreadContext({
        threadId: task.payload.threadId,
        taskId: task.id,
        promptMode,
        usedTokens: projectedUsedTokens,
        totalTokens: requestedContextLength,
        phase: "before",
        continuationIndex: 0,
      });

      if (maybeCompacted.thread) {
        thread = maybeCompacted.thread;
      }
      if (maybeCompacted.collapsed) {
        setSummaryCallsInCurrentRequest(summaryCallsInCurrentRequest + 1);
      }
    }

    const generatedImageLimit = getAdaptiveGeneratedImageLimit({
      contextLength: requestedContextLength,
      userMessage: task.payload.userMessage,
    });
    const userInput = buildLmStudioInput({
      summary: thread?.conversationSummary ?? null,
      previousResponseId: thread?.lmstudioResponseId ?? null,
      generatedImages:
        thread && task.payload.kind === "conversation"
          ? getGeneratedImagesForThread(thread.messages, generatedImageLimit)
          : [],
      userMessage: task.payload.userMessage,
    });

    const exactLoadedModel = await ensureLmStudioModelLoaded({
      modelKey: getChatModelKey(),
      contextLength: requestedContextLength,
    });
    const modelTarget = await resolvePreferredLmStudioModelTarget({
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

    let streamedText = "";
    let streamedReasoning = "";
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

    const runChatAttempt = async ({
      input,
      previousResponseId,
    }: {
      input: string | LmStudioInputItem[];
      previousResponseId?: string;
    }): Promise<{
      overflowDetected: boolean;
      usedTokens: number | null;
      finalResponse: ChatResponse | null;
    }> => {
      const response = await fetch(getLmStudioChatUrl(), {
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
          system_prompt: getSystemPromptForMode(promptMode),
          integrations: buildIntegrations(promptMode),
          stream: true,
        }),
      });

      if (!response.ok) {
        const data = (await response.json()) as ChatResponse;
        console.error("[chat-runner] rest:error-response", {
          taskId: task.id,
          threadId: task.payload.threadId ?? null,
          status: response.status,
          data,
        });
        throw new Error(
          data.error?.message ?? "LM Studio chat request failed.",
        );
      }
      if (!response.body) {
        throw new Error("LM Studio did not return a stream body.");
      }

      let localStreamedText = "";
      let localStreamedReasoning = "";
      let localFinalResponse: ChatResponse | null = null;
      let localStreamErrorMessage: string | null = null;

      try {
        await parseSseEvents(response.body, (event) => {
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
        });
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
      const overflowDetected =
        interruptedWithoutEnd ||
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

      const usedTokens = getUsedContextTokens(resolvedFinalResponse);

      return {
        overflowDetected,
        usedTokens,
        finalResponse: resolvedFinalResponse,
      };
    };

    const initialAttempt = await runChatAttempt({
      input: userInput,
      previousResponseId: thread?.lmstudioResponseId ?? undefined,
    });

    let finalResponse: ChatResponse | null = initialAttempt.finalResponse;
    let overflowDetected = initialAttempt.overflowDetected;
    let currentUsedTokens = initialAttempt.usedTokens;
    let nearLimitDetected =
      currentUsedTokens !== null &&
      currentUsedTokens >= requestedContextLength - 2;
    let shouldForceContinue = overflowDetected || nearLimitDetected;

    let continuationCount = 0;
    while (
      shouldForceContinue &&
      continuationCount < MAX_OVERFLOW_CONTINUATIONS_PER_TASK &&
      task.payload.kind === "conversation" &&
      task.payload.threadId
    ) {
      continuationCount += 1;
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

      const maybeCompacted = await maybeAutoCompactThreadContext({
        threadId: task.payload.threadId,
        taskId: task.id,
        promptMode,
        usedTokens: requestedContextLength,
        totalTokens: requestedContextLength,
        phase: "after",
        continuationIndex: continuationCount,
        interruption: {
          interrupted: true,
          interruptedAssistantTailChars,
          interruptedAssistantFullText: streamedText,
          interruptionContext:
            "The assistant response was interrupted during generation near context limit. Resume from this checkpoint, continue forward only, and avoid repeating already emitted items.",
        },
        force: true,
      });

      if (maybeCompacted.thread) {
        thread = maybeCompacted.thread;
      }
      if (maybeCompacted.collapsed) {
        setSummaryCallsInCurrentRequest(summaryCallsInCurrentRequest + 1);
        publishRunningResult(finalResponse?.response_id ?? null);
      }

      const continuationInput = buildOverflowContinuationInput({
        summary: thread?.conversationSummary ?? null,
        userMessage: task.payload.userMessage,
        partialAssistantText: streamedText,
        continuationIndex: continuationCount,
      });

      const continuationAttempt = await runChatAttempt({
        input: continuationInput,
      });

      if (continuationAttempt.finalResponse) {
        finalResponse = continuationAttempt.finalResponse;
      }
      overflowDetected = continuationAttempt.overflowDetected;
      currentUsedTokens = continuationAttempt.usedTokens;
      nearLimitDetected =
        currentUsedTokens !== null &&
        currentUsedTokens >= requestedContextLength - 2;
      shouldForceContinue = overflowDetected || nearLimitDetected;
    }

    if (
      continuationCount >= MAX_OVERFLOW_CONTINUATIONS_PER_TASK &&
      shouldForceContinue
    ) {
      console.error("[chat-runner] reached continuation safety cap", {
        taskId: task.id,
        threadId: task.payload.threadId ?? null,
        continuationCount,
        usedTokens: currentUsedTokens,
        totalTokens: requestedContextLength,
      });
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

    if (task.payload.threadId) {
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

      if (task.payload.kind === "conversation") {
        const maybeCompacted = await maybeAutoCompactThreadContext({
          threadId: task.payload.threadId,
          taskId: task.id,
          promptMode,
          usedTokens:
            usedContextTokens ?? updatedThread?.contextWindowUsedTokens ?? null,
          totalTokens: requestedContextLength,
          phase: "after",
          continuationIndex: continuationCount + 1,
          force: overflowDetected,
        });

        if (maybeCompacted.collapsed) {
          setSummaryCallsInCurrentRequest(summaryCallsInCurrentRequest + 1);
        }
      }
    }

    markTaskCompleted(task.id, {
      text: applyCompactionMarkersToText(text, inRequestCompactionBreakOffsets),
      reasoning,
      responseId: finalResponse?.response_id ?? null,
      summaryCallsInCurrentRequest,
    });

    if (task.payload.kind === "conversation" && task.payload.threadId) {
      updateThread(task.payload.threadId, {
        summaryCallsInCurrentRequest: 0,
      });
      maybeEnqueueTitleGenerationTask(task.payload.threadId);
    }
  } catch (error) {
    if (task.payload.kind === "conversation" && task.payload.threadId) {
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
    markTaskCompleted(taskId, {
      title: thread.title,
    });
    return;
  }

  const inferredTitle = await generateThreadTitle(thread);
  const nextTitle = inferredTitle || thread.title || "New Chat";
  const updatedThread = updateThread(threadId, {
    title: nextTitle,
    titleGenerated: !isPlaceholderThreadTitle(nextTitle),
  });

  markTaskCompleted(taskId, {
    title: updatedThread?.title ?? nextTitle,
  });
};

const executeQueuedCollapseContextTask = async (
  taskId: string,
  threadId: string,
  promptMode: string,
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
  });

  markTaskCompleted(taskId, {
    summaryCollapsed: result.collapsed,
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

const buildOverflowContinuationInput = ({
  summary,
  userMessage,
  partialAssistantText,
  continuationIndex,
}: {
  summary: string | null;
  userMessage: MessagePart[];
  partialAssistantText: string;
  continuationIndex: number;
}) => {
  const userText =
    getTextFromMessageContent(userMessage).trim() ||
    formatMessageContentForPrompt(userMessage);
  const partialTail =
    partialAssistantText.length > MAX_CONTINUATION_PARTIAL_CHARS
      ? partialAssistantText.slice(-MAX_CONTINUATION_PARTIAL_CHARS)
      : partialAssistantText;

  const continuationPrompt = [
    `Continuation step: ${continuationIndex}.`,
    "Task: continue exactly where the interrupted answer stopped.",
    "Hard rules (must follow):",
    "1) Never restart from the beginning.",
    "2) Continue directly from the checkpoint tail below.",
    "3) Never repeat items that were already output.",
    "4) If table was interrupted, restart table cleanly with a header row and separator row and repeat last listed item.",
    "",
    `User message:\n${userText}`,
    "",
    "Interrupted output tail (authoritative checkpoint):",
    partialTail.trim() || "(none)",
    "",
    "Output policy:",
    "- Output only the continuation content.",
    "- No meta commentary, no explanation about continuation.",
  ].join("\n");

  return buildFreshChainInput({
    summary,
    userInput: continuationPrompt,
  });
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
  });
};
