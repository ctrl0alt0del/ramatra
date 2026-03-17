import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import type { PendingChatStreamState } from "@/lib/tasks/chat/handlers/conversation-runtime.types";

export const registerPendingConversationStream = ({
  taskId,
  stream,
  promptMode,
  requestedContextLength,
  modelTarget,
  summaryCallsInCurrentRequest,
  getPendingChatStreams,
}: {
  taskId: string;
  stream: ReadableStream<Uint8Array>;
  promptMode: PromptMode;
  requestedContextLength: number;
  modelTarget: string;
  summaryCallsInCurrentRequest: number;
  getPendingChatStreams: () => Map<string, PendingChatStreamState>;
}) => {
  getPendingChatStreams().set(taskId, {
    stream,
    promptMode,
    requestedContextLength,
    modelTarget,
    summaryCallsInCurrentRequest,
  });
};

export const takePendingConversationStream = ({
  taskId,
  getPendingChatStreams,
}: {
  taskId: string;
  getPendingChatStreams: () => Map<string, PendingChatStreamState>;
}) => {
  const pendingStream = getPendingChatStreams().get(taskId);
  if (!pendingStream) {
    throw new Error("chat.stream task has no pending stream.");
  }

  return {
    pendingStream,
    clear: () => {
      getPendingChatStreams().delete(taskId);
    },
  };
};
