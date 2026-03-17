import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import type { LmStudioInputItem } from "@/lib/tasks/chat/lm-input";
import { executeConversationGenerateStage } from "@/lib/tasks/chat/handlers/conversation-generate";
import { setupConversationStreaming } from "@/lib/tasks/chat/handlers/conversation-streaming-setup";
import { executePendingConversationStream } from "@/lib/tasks/chat/handlers/conversation-streaming-execute";
import {
  registerPendingConversationStream,
} from "@/lib/tasks/chat/handlers/conversation-pending-stream";
import type { Task } from "@/lib/tasks/types";
import type {
  ChatTask,
  ConversationRuntimeDeps,
  PendingChatStreamState,
} from "@/lib/tasks/chat/handlers/conversation-runtime.types";

export const executeConversationStreamingLifecycle = async ({
  task,
  taskKind,
  modelTarget,
  userInput,
  effectivePreviousResponseId,
  summaryCallsInCurrentRequest,
  promptMode,
  moodId,
  requestedContextLength,
  requestLmStudioChat,
  formatUnknownError,
  setGroupTaskStatusByKind,
  updateRunningTask,
  getPendingChatStreams,
}: {
  task: ChatTask;
  taskKind: "chat.generate" | "chat.stream";
  modelTarget: string;
  userInput: string | LmStudioInputItem[] | null;
  effectivePreviousResponseId: string | null;
  summaryCallsInCurrentRequest: number;
  promptMode: PromptMode;
  moodId: string | null;
  requestedContextLength: number;
  requestLmStudioChat: ConversationRuntimeDeps["requestLmStudioChat"];
  formatUnknownError: ConversationRuntimeDeps["formatUnknownError"];
  setGroupTaskStatusByKind: (args: {
    taskId: string;
    kind: Task["kind"];
    status: "pending" | "completed";
  }) => void;
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
  getPendingChatStreams: () => Map<string, PendingChatStreamState>;
}) => {
  const { streamState, openChatGenerationStream } = setupConversationStreaming({
    task,
    summaryCallsInCurrentRequest,
    modelTarget,
    requestedContextLength,
    promptMode,
    moodId,
    requestLmStudioChat,
    formatUnknownError,
    updateRunningTask,
  });

  if (
    await executeConversationGenerateStage({
      task,
      taskKind,
      userInput,
      effectivePreviousResponseId,
      openChatGenerationStream,
      setPendingStream: (stream) => {
        registerPendingConversationStream({
          taskId: task.id,
          stream,
          promptMode,
          requestedContextLength,
          modelTarget,
          summaryCallsInCurrentRequest,
          getPendingChatStreams,
        });
      },
      setGroupTaskStatusByKind,
    })
  ) {
    return { delegated: true as const };
  }

  const initialAttempt = await executePendingConversationStream({
    taskId: task.id,
    threadId: task.payload.threadId ?? null,
    modelTarget,
    getPendingChatStreams,
    onReasoningDelta: streamState.appendReasoningDelta,
    onMessageDelta: streamState.appendTextDelta,
    onPublishRunningResult: streamState.publishRunningResult,
  });

  return {
    delegated: false as const,
    streamedText: streamState.getStreamedText(),
    streamedReasoning: streamState.getStreamedReasoning(),
    inRequestCompactionBreakOffsets: streamState.inRequestCompactionBreakOffsets,
    initialAttempt,
  };
};
