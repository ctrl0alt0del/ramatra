import {
  formatMessageContentForPrompt,
  getTextFromMessageContent,
  type MessagePart,
} from "@/lib/chat/message-content";
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
    }
  | {
      type: string;
      content?: string;
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

  const usage = response.usage ?? {};
  const stats = response.stats ?? {};

  return (
    readTokenCount(usage.total_tokens) ??
    readTokenCount(usage.totalTokens) ??
    readTokenCount(usage.input_tokens) ??
    readTokenCount(usage.prompt_tokens) ??
    readTokenCount(stats.total_tokens) ??
    readTokenCount(stats.totalTokens) ??
    readTokenCount(stats.input_tokens) ??
    readTokenCount(stats.prompt_tokens) ??
    null
  );
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

const collapseThreadContext = async ({
  threadId,
  promptMode,
}: {
  threadId: string;
  promptMode: PromptMode;
}) => {
  const thread = getThread(threadId);
  if (!thread) {
    return { collapsed: false as const, thread: null };
  }

  const unsummarizedMessages = thread.messages.slice(thread.summaryMessageCount);
  if (!unsummarizedMessages.length) {
    return { collapsed: false as const, thread };
  }

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
    contextWindowUsedTokens: null,
  });

  return {
    collapsed: true as const,
    thread: updatedThread ?? getThread(thread.id),
  };
};

const maybeAutoCompactThreadContext = async ({
  threadId,
  promptMode,
  usedTokens,
  totalTokens,
  phase,
}: {
  threadId: string;
  promptMode: PromptMode;
  usedTokens: number | null;
  totalTokens: number;
  phase: "before" | "after";
}) => {
  if (!shouldCompactForRatio({ usedTokens, totalTokens })) {
    return getThread(threadId);
  }

  try {
    const result = await collapseThreadContext({
      threadId,
      promptMode,
    });

    if (result.collapsed) {
      console.info("[chat-runner] auto-collapsed context", {
        threadId,
        phase,
        usedTokens,
        totalTokens,
      });
    }

    return result.thread;
  } catch (error) {
    console.warn("[chat-runner] failed auto context collapse", {
      threadId,
      phase,
      usedTokens,
      totalTokens,
      error,
    });
    return getThread(threadId);
  }
};

const buildIntegrations = () => {
  const integrations = [
    {
      type: "ephemeral_mcp",
      server_label: "comfy",
      server_url: getComfyMcpUrl(),
    },
  ];

  if (
    process.env.WEB_SEARCH_MCP_ENABLED === "true" &&
    process.env.WEB_SEARCH_MCP_URL
  ) {
    integrations.push({
      type: "ephemeral_mcp",
      server_label: "web_search",
      server_url: process.env.WEB_SEARCH_MCP_URL,
    });
  }

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

  return integrations;
};

const parseSseEvents = async (
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
) => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const separatorIndex = buffer.indexOf("\n\n");
      if (separatorIndex === -1) break;

      const rawEventBlock = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

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
        continue;
      }

      const data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
      onEvent({
        type: eventType,
        ...(data as object),
      } as ChatStreamEvent);
    }
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

    let thread = task.payload.threadId ? getThread(task.payload.threadId) : null;
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
        console.warn("[chat-runner] failed to refresh conversation summary", error);
      }
    }

    const requestedContextLength = getConfiguredContextLengthForMode(
      promptMode,
      process.env,
    );

    if (task.payload.threadId && task.payload.kind === "conversation" && thread) {
      const estimatedUpcomingTokens = estimateMessageTokens(task.payload.userMessage);
      const projectedUsedTokens =
        thread.contextWindowUsedTokens === null
          ? null
          : thread.contextWindowUsedTokens + estimatedUpcomingTokens;

      const maybeCompacted = await maybeAutoCompactThreadContext({
        threadId: task.payload.threadId,
        promptMode,
        usedTokens: projectedUsedTokens,
        totalTokens: requestedContextLength,
        phase: "before",
      });

      if (maybeCompacted) {
        thread = maybeCompacted;
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
        input: userInput,
        previous_response_id: thread?.lmstudioResponseId ?? undefined,
        system_prompt: getSystemPromptForMode(promptMode),
        integrations: buildIntegrations(),
        stream: true,
      }),
    });
    if (!response.ok) {
      const data = (await response.json()) as ChatResponse;
      throw new Error(data.error?.message ?? "LM Studio chat request failed.");
    }
    if (!response.body) {
      throw new Error("LM Studio did not return a stream body.");
    }

    let streamedText = "";
    let streamedReasoning = "";
    let finalResponse: ChatResponse | null = null;

    await parseSseEvents(response.body, (event) => {
      if (event.type === "reasoning.delta" && typeof event.content === "string") {
        streamedReasoning += event.content;
        updateRunningTask(task.id, {
          result: {
            text: streamedText,
            reasoning: streamedReasoning,
            responseId: finalResponse?.response_id ?? null,
          },
        });
        return;
      }

      if (event.type === "message.delta" && typeof event.content === "string") {
        streamedText += event.content;
        updateRunningTask(task.id, {
          result: {
            text: streamedText,
            reasoning: streamedReasoning,
            responseId: finalResponse?.response_id ?? null,
          },
        });
        return;
      }

      if (event.type === "error") {
        throw new Error(event.error?.message ?? "LM Studio streaming error.");
      }

      if (event.type === "chat.end") {
        finalResponse = event.result;
        logChatModelDebug("request:end", {
          taskId: task.id,
          threadId: thread?.id ?? null,
          selectedModelTarget: modelTarget,
          responseId: event.result.response_id ?? null,
          responseModelInstanceId: event.result.model_instance_id ?? null,
        });
      }
    });

    const text =
      (finalResponse?.output?.length
        ? getAssistantText(finalResponse.output)
        : "") || streamedText;
    const reasoning =
      (finalResponse?.output?.length
        ? getAssistantReasoning(finalResponse.output)
        : "") || streamedReasoning;

    if (!text.trim() && !reasoning.trim()) {
      throw new Error("LM Studio did not return any output.");
    }

    if (task.payload.threadId) {
      const latestThread = getThread(task.payload.threadId);
      const lastMessage = latestThread?.messages.at(-1);
      const usedContextTokens = getUsedContextTokens(finalResponse);

      const updatedThread = updateThread(task.payload.threadId, {
        lmstudioResponseId: finalResponse?.response_id ?? null,
        lmstudioModelInstanceId: finalResponse?.model_instance_id ?? null,
        lastPromptMode: promptMode,
        contextWindowUsedTokens: usedContextTokens,
        contextWindowTotalTokens: requestedContextLength,
        appendMessages:
          !lastMessage ||
          lastMessage.role !== "assistant" ||
          getTextFromMessageContent(lastMessage.content) !== text
            ? [
                {
                  role: "assistant",
                  content: [{ type: "text", text }],
                },
              ]
            : undefined,
      });

      if (task.payload.kind === "conversation") {
        await maybeAutoCompactThreadContext({
          threadId: task.payload.threadId,
          promptMode,
          usedTokens:
            usedContextTokens ??
            updatedThread?.contextWindowUsedTokens ??
            null,
          totalTokens: requestedContextLength,
          phase: "after",
        });
      }
    }

    markTaskCompleted(task.id, {
      text,
      reasoning,
      responseId: finalResponse?.response_id ?? null,
    });

    if (task.payload.kind === "conversation" && task.payload.threadId) {
      maybeEnqueueTitleGenerationTask(task.payload.threadId);
    }
  } catch (error) {
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

      if (unloaded.length > 0) {
        console.info(
          `[chat-runner] unloaded redundant LM Studio models: ${unloaded
            .map((model) => `${model.modelKey} (${model.instanceId})`)
            .join(", ")}`,
        );
      }

      logChatModelDebug("cleanup:after", {
        taskId,
        loadedModels: formatLoadedLmStudioModelsForDebug(loadedAfterCleanup),
        unloaded: formatLoadedLmStudioModelsForDebug(unloaded),
      });
    } catch (error) {
      console.warn("[chat-runner] failed to cleanup redundant LM Studio models", error);
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
      (part): part is Extract<MessagePart, { type: "image" }> => part.type === "image",
    ),
    ...userMessage.filter(
      (part): part is Extract<MessagePart, { type: "image" }> => part.type === "image",
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
