import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import { createConversationStreamingState } from "@/lib/tasks/chat/handlers/conversation-streaming-state";
import { createOpenConversationStream } from "@/lib/tasks/chat/handlers/conversation-stream-open-factory";
import type { ChatTask, ConversationRuntimeDeps } from "@/lib/tasks/chat/handlers/conversation-runtime.types";

export const setupConversationStreaming = ({
  task,
  summaryCallsInCurrentRequest,
  modelTarget,
  requestedContextLength,
  promptMode,
  moodId,
  requestLmStudioChat,
  formatUnknownError,
  updateRunningTask,
}: {
  task: ChatTask;
  summaryCallsInCurrentRequest: number;
  modelTarget: string;
  requestedContextLength: number;
  promptMode: PromptMode;
  moodId: string | null;
  requestLmStudioChat: ConversationRuntimeDeps["requestLmStudioChat"];
  formatUnknownError: ConversationRuntimeDeps["formatUnknownError"];
  updateRunningTask: (
    taskId: string,
    patch: {
      result: {
        text: string;
        reasoning: string;
        responseId: string | null;
        summaryCallsInCurrentRequest: number;
      };
    },
  ) => void;
}) => {
  const streamState = createConversationStreamingState({
    initialText:
      task.payload.kind === "conversation" ? (task.payload.carryoverText ?? "") : "",
    initialReasoning:
      task.payload.kind === "conversation"
        ? (task.payload.carryoverReasoning ?? "")
        : "",
    summaryCallsInCurrentRequest,
    updateRunningTask,
    taskId: task.id,
  });
  streamState.publishRunningResult(null);

  const openChatGenerationStream = createOpenConversationStream({
    taskId: task.id,
    threadId: task.payload.threadId ?? null,
    modelTarget,
    requestedContextLength,
    promptMode,
    moodId,
    requestLmStudioChat,
    formatUnknownError,
  });

  return {
    streamState,
    openChatGenerationStream,
  };
};
