import type { TaskGroup } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export const persistAndCompleteConversationStream = ({
  task,
  finalResponse,
  finalTextWithMarkers,
  reasoning,
  finalResponseId,
  promptMode,
  moodId,
  requestedContextLength,
  continuationCount,
  compactThresholdRatio,
  summaryCallsInCurrentRequest,
  persistConversationStreamResult,
  setGroupTaskStatusByKind,
  finalizeConversationViaStreamTask,
  updateThread,
  maybeEnqueueTitleGenerationTask,
}: {
  task: ChatTask;
  finalResponse: {
    response_id?: string | null;
    model_instance_id?: string | null;
    usage?: Record<string, unknown>;
    stats?: Record<string, unknown>;
  } | null;
  finalTextWithMarkers: string;
  reasoning: string;
  finalResponseId: string | null;
  promptMode: import("@/lib/lmstudio/prompt-modes").PromptMode;
  moodId: string | null;
  requestedContextLength: number;
  continuationCount: number;
  compactThresholdRatio: number;
  summaryCallsInCurrentRequest: number;
  persistConversationStreamResult: (args: {
    task: ChatTask;
    finalResponse: {
      response_id?: string | null;
      model_instance_id?: string | null;
      usage?: Record<string, unknown>;
      stats?: Record<string, unknown>;
    } | null;
    textWithCompactionMarkers: string;
    promptMode: import("@/lib/lmstudio/prompt-modes").PromptMode;
    moodId: string | null;
    requestedContextLength: number;
    continuationCount: number;
    compactThresholdRatio: number;
  }) => void;
  setGroupTaskStatusByKind: (args: {
    taskId: string;
    kind: "chat.stream";
    status: "completed";
  }) => void;
  finalizeConversationViaStreamTask: (args: {
    taskId: string;
    text: string;
    reasoning: string;
    responseId: string | null;
    summaryCallsInCurrentRequest: number;
  }) => void;
  updateThread: (
    threadId: string,
    patch: { summaryCallsInCurrentRequest: number },
  ) => unknown;
  maybeEnqueueTitleGenerationTask: (threadId: string) => void;
}) => {
  persistConversationStreamResult({
    task,
    finalResponse,
    textWithCompactionMarkers: finalTextWithMarkers,
    promptMode,
    moodId,
    requestedContextLength,
    continuationCount,
    compactThresholdRatio,
  });

  setGroupTaskStatusByKind({
    taskId: task.id,
    kind: "chat.stream",
    status: "completed",
  });

  finalizeConversationViaStreamTask({
    taskId: task.id,
    text: finalTextWithMarkers,
    reasoning,
    responseId: finalResponseId,
    summaryCallsInCurrentRequest,
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
};
