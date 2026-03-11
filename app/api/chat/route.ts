import { z } from "zod";

import { extractComfyJobMarker } from "@/components/chat/comfy-marker";
import { getThread, updateThread } from "@/lib/lmstudio/threads";
import { defaultPromptMode, isPromptMode } from "@/lib/lmstudio/prompt-modes";
import { getSystemPromptForMode } from "@/lib/lmstudio/prompts";
import {
  buildFreshChainInput,
  generateConversationSummary,
  shouldRefreshConversationSummary,
} from "@/lib/lmstudio/summaries";
import {
  assertChatAvailable,
  getVramBalancerState,
  registerImageGenerationStart,
} from "@/lib/vram/balancer";

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z
    .array(
      z.object({
        type: z.string(),
        text: z.string().optional(),
      }),
    )
    .optional(),
});

const requestSchema = z.object({
  messages: z.array(messageSchema),
  threadId: z.string().optional(),
  promptMode: z.string().optional(),
});

const toChatMessages = (messages: Array<z.infer<typeof messageSchema>>) => {
  return messages
    .map((message) => {
      const text = (message.content ?? [])
        .flatMap((part) =>
          part.type === "text" && typeof part.text === "string"
            ? [part.text]
            : [],
        )
        .join("\n\n")
        .trim();

      if (!text) return null;

      return {
        role: message.role,
        content: text,
      };
    })
    .filter(
      (
        message,
      ): message is {
        role: "system" | "user" | "assistant";
        content: string;
      } => {
        return message !== null;
      },
    );
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
      type: "tool_call";
      tool: string;
      arguments: Record<string, unknown>;
      output: string;
      provider_info?: {
        type: "plugin" | "ephemeral_mcp";
        plugin_id?: string;
        server_label?: string;
      };
    }
  | {
      type: "invalid_tool_call";
      reason: string;
      metadata?: {
        type: "invalid_name" | "invalid_arguments";
        tool_name: string;
        arguments?: Record<string, unknown>;
      };
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

export async function POST(req: Request) {
  try {
    assertChatAvailable();
  } catch (error) {
    const state = getVramBalancerState();
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Chat is unavailable.",
        state,
      },
      { status: 409 },
    );
  }

  const json = await req.json();
  const parsed = requestSchema.safeParse(json);

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid chat request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const inputMessages = toChatMessages(parsed.data.messages);
  let thread = parsed.data.threadId ? getThread(parsed.data.threadId) : null;
  const promptMode =
    parsed.data.promptMode && isPromptMode(parsed.data.promptMode)
      ? parsed.data.promptMode
      : defaultPromptMode;
  const latestUserMessage = [...inputMessages]
    .reverse()
    .find((message) => message.role === "user");

  if (!latestUserMessage) {
    return Response.json(
      { error: "Chat request must include a user message." },
      { status: 400 },
    );
  }

  if (thread && shouldRefreshConversationSummary(thread, promptMode)) {
    try {
      const unsummarizedMessages = thread.messages.slice(thread.summaryMessageCount);
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
      console.warn(
        "[api/chat] failed to refresh conversation summary",
        error,
      );
    }
  }

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
      input:
        thread?.lmstudioResponseId !== null && thread?.lmstudioResponseId !== undefined
          ? latestUserMessage.content
          : buildFreshChainInput({
              summary: thread?.conversationSummary ?? null,
              userInput: latestUserMessage.content,
            }),
      previous_response_id: thread?.lmstudioResponseId ?? undefined,
      system_prompt: getSystemPromptForMode(promptMode),
      integrations: integrations,
    }),
  });

  const data = (await response.json()) as ChatResponse;
  if (!response.ok) {
    return Response.json(
      {
        error: data.error?.message ?? "LM Studio chat request failed.",
      },
      { status: response.status },
    );
  }

  if (!data.output?.length) {
    return Response.json(
      { error: "LM Studio did not return any output." },
      { status: 502 },
    );
  }

  if (parsed.data.threadId) {
    updateThread(parsed.data.threadId, {
      lmstudioResponseId: data.response_id ?? null,
    });
  }

  const text = getAssistantText(data.output);
  const reasoning = getAssistantReasoning(data.output);
  const { marker } = extractComfyJobMarker(text);

  if (marker) {
    await registerImageGenerationStart(marker.jobId);
  }

  return Response.json({
    text,
    reasoning,
    responseId: data.response_id ?? null,
    meta: {
      finishReason: data.finish_reason ?? data.stop_reason ?? null,
      usage: data.usage ?? null,
      model: data.model ?? null,
    },
  });
}
