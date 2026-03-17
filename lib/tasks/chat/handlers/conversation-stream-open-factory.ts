import { openConversationChatGenerationStream } from "@/lib/tasks/chat/handlers/conversation-stream";
import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import type { LmStudioInputItem } from "@/lib/tasks/chat/lm-input";
import type { ConversationRuntimeDeps } from "@/lib/tasks/chat/handlers/conversation-runtime.types";
import type { EphemeralMcpIntegration } from "@/lib/tasks/chat/integrations";

export const createOpenConversationStream = ({
  taskId,
  threadId,
  modelTarget,
  requestedContextLength,
  promptMode,
  moodId,
  requestLmStudioChat,
  formatUnknownError,
}: {
  taskId: string;
  threadId: string | null;
  modelTarget: string;
  requestedContextLength: number;
  promptMode: PromptMode;
  moodId: string | null;
  requestLmStudioChat: ConversationRuntimeDeps["requestLmStudioChat"];
  formatUnknownError: ConversationRuntimeDeps["formatUnknownError"];
}) => {
  return ({
    input,
    previousResponseId,
    systemPrompt,
    integrations,
    forceSystemPrompt,
  }: {
    input: string | LmStudioInputItem[];
    previousResponseId?: string;
    systemPrompt?: string;
    integrations?: EphemeralMcpIntegration[];
    forceSystemPrompt?: boolean;
  }) =>
    openConversationChatGenerationStream({
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
    });
};
