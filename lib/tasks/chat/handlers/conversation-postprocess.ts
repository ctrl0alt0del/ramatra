import { logUtilTaskNoCommandIfNeeded } from "@/lib/tasks/chat/handlers/conversation-util-no-command-log";
import { persistAndCompleteConversationStream } from "@/lib/tasks/chat/handlers/conversation-persist-complete";
import type { TaskGroup } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export const finalizeConversationPostStream = ({
  task,
  parsedCommand,
  text,
  reasoning,
  finalTextWithMarkers,
  finalResponseId,
  summaryCallsInCurrentRequest,
  finalResponse,
  promptMode,
  moodId,
  requestedContextLength,
  continuationCount,
  compactThresholdRatio,
  persistConversationStreamResult,
  finalizeConversationViaStreamTask,
  setGroupTaskStatusByKind,
  updateThread,
  maybeEnqueueTitleGenerationTask,
}: {
  task: ChatTask;
  parsedCommand: { command: unknown | null };
  text: string;
  reasoning: string;
  finalTextWithMarkers: string;
  finalResponseId: string | null;
  summaryCallsInCurrentRequest: number;
  finalResponse: {
    response_id?: string | null;
    model_instance_id?: string | null;
    usage?: Record<string, unknown>;
    stats?: Record<string, unknown>;
  } | null;
  promptMode: import("@/lib/lmstudio/prompt-modes").PromptMode;
  moodId: string | null;
  requestedContextLength: number;
  continuationCount: number;
  compactThresholdRatio: number;
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
  finalizeConversationViaStreamTask: (args: {
    taskId: string;
    text: string;
    reasoning: string;
    responseId: string | null;
    summaryCallsInCurrentRequest: number;
  }) => void;
  setGroupTaskStatusByKind: (args: {
    taskId: string;
    kind: "chat.stream";
    status: "completed";
  }) => void;
  updateThread: (
    threadId: string,
    patch: { summaryCallsInCurrentRequest: number },
  ) => unknown;
  maybeEnqueueTitleGenerationTask: (threadId: string) => void;
}) => {
  logUtilTaskNoCommandIfNeeded({
    task,
    parsedCommand,
    text,
    reasoning,
  });

  persistAndCompleteConversationStream({
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
  });
};
