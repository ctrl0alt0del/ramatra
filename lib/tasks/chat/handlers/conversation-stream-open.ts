import type { EphemeralMcpIntegration } from "@/lib/tasks/chat/integrations";
import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import type { LmStudioInputItem } from "@/lib/tasks/chat/lm-input";
import { requestConversationChatGenerationStream } from "@/lib/tasks/chat/handlers/conversation-stream-open-request";
import { resolveConversationStreamResponseBody } from "@/lib/tasks/chat/handlers/conversation-stream-open-response";

export const openConversationChatGenerationStream = async ({
  taskId,
  threadId,
  modelTarget,
  requestedContextLength,
  promptMode,
  moodId,
  input,
  previousResponseId,
  systemPrompt,
  forceSystemPrompt,
  integrations,
  requestLmStudioChat,
  formatUnknownError,
}: {
  taskId: string;
  threadId: string | null;
  modelTarget: string;
  requestedContextLength: number;
  promptMode: PromptMode;
  moodId: string | null;
  input: string | LmStudioInputItem[];
  previousResponseId?: string;
  systemPrompt?: string;
  forceSystemPrompt?: boolean;
  integrations?: EphemeralMcpIntegration[];
  requestLmStudioChat: (args: {
    model: string;
    contextLength: number;
    input: string | LmStudioInputItem[];
    previousResponseId?: string;
    systemPrompt: string;
    forceSystemPrompt?: boolean;
    integrations?: EphemeralMcpIntegration[];
    stream?: boolean;
  }) => Promise<Response>;
  formatUnknownError: (error: unknown) => {
    name: string;
    message: string;
    stack: string | null;
  };
}) => {
  let response: Response;
  try {
    response = await requestConversationChatGenerationStream({
      modelTarget,
      requestedContextLength,
      promptMode,
      moodId,
      input,
      previousResponseId,
      systemPrompt,
      forceSystemPrompt,
      integrations,
      requestLmStudioChat,
    });
  } catch (error) {
    console.error("[chat-runner] generate:request-failed", {
      taskId,
      threadId,
      selectedModelTarget: modelTarget,
      requestedContextLength,
      error: formatUnknownError(error),
    });
    throw error;
  }

  return resolveConversationStreamResponseBody({
    response,
    taskId,
    threadId,
    modelTarget,
    requestedContextLength,
  });
};
