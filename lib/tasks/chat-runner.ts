import { getConfiguredContextLengthForMode } from "@/lib/lmstudio/context-length";
import {
  getThread,
  updateThread,
} from "@/lib/lmstudio/threads";
import { defaultPromptMode, isPromptMode } from "@/lib/lmstudio/prompt-modes";
import { getSystemPromptForMode } from "@/lib/lmstudio/prompts";
import {
  buildFreshChainInput,
  generateConversationSummary,
  shouldRefreshConversationSummary,
} from "@/lib/lmstudio/summaries";
import { processTaskQueues } from "@/lib/tasks/processor";
import {
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
  finish_reason?: string;
  stop_reason?: string;
  usage?: Record<string, unknown>;
  model?: string;
  error?: {
    message?: string;
  };
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

const getComfyMcpUrl = () => {
  const explicitUrl = process.env.COMFY_MCP_URL;
  if (explicitUrl) {
    return explicitUrl;
  }

  const port = process.env.COMFY_MCP_PORT ?? "4000";
  return `http://127.0.0.1:${port}/mcp`;
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

    const response = await fetch(getLmStudioChatUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.LM_STUDIO_TOKEN
          ? { Authorization: `Bearer ${process.env.LM_STUDIO_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        model: process.env.LM_STUDIO_MODEL,
        context_length: getConfiguredContextLengthForMode(promptMode, process.env),
        input:
          thread?.lmstudioResponseId !== null &&
          thread?.lmstudioResponseId !== undefined
            ? task.payload.userMessage
            : buildFreshChainInput({
                summary: thread?.conversationSummary ?? null,
                userInput: task.payload.userMessage,
              }),
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
      }
    });

    if (!finalResponse?.output?.length) {
      throw new Error("LM Studio did not return any output.");
    }

    if (task.payload.threadId) {
      updateThread(task.payload.threadId, {
        lmstudioResponseId: finalResponse.response_id ?? null,
        lastPromptMode: promptMode,
      });
    }

    const text = getAssistantText(finalResponse.output) || streamedText;
    const reasoning =
      getAssistantReasoning(finalResponse.output) || streamedReasoning;

    markTaskCompleted(task.id, {
      text,
      reasoning,
      responseId: finalResponse.response_id ?? null,
    });
  } catch (error) {
    markTaskFailed(
      taskId,
      error instanceof Error ? error.message : "Chat task failed.",
    );
  } finally {
    void processTaskQueues();
  }
};
