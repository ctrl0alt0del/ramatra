import { assertConversationRuntimeHasOutput } from "@/lib/tasks/chat/handlers/conversation-runtime-output-guard";
import { continueConversationRuntimeUtilCommandIfNeeded } from "@/lib/tasks/chat/handlers/conversation-runtime-util-command";
import { completeConversationRuntimeAfterStreaming } from "@/lib/tasks/chat/handlers/conversation-runtime-complete";
import type {
  ChatResponse,
  ChatTask,
  ConversationRuntimeDeps,
  RuntimeThreadSnapshot,
} from "@/lib/tasks/chat/handlers/conversation-runtime.types";

export const finalizeConversationRuntimeAfterStreaming = ({
  task,
  thread,
  promptMode,
  moodId,
  requestedContextLength,
  compactThresholdRatio,
  continuationCount,
  summaryCallsInCurrentRequest,
  finalResponse,
  overflowDetected,
  streamedText,
  streamedReasoning,
  inRequestCompactionBreakOffsets,
  persistConversationStreamResult,
  maybeEnqueueTitleGenerationTask,
  finalizeConversationViaStreamTask,
  setGroupTaskStatusByKind,
  updateRunningTask,
  updateChatTaskPayload,
  updateThread,
  buildUtilHistorySnapshot,
}: {
  task: ChatTask;
  thread: RuntimeThreadSnapshot;
  promptMode: import("@/lib/lmstudio/prompt-modes").PromptMode;
  moodId: string | null;
  requestedContextLength: number;
  compactThresholdRatio: number;
  continuationCount: number;
  summaryCallsInCurrentRequest: number;
  finalResponse: ChatResponse | null;
  overflowDetected: boolean;
  streamedText: string;
  streamedReasoning: string;
  inRequestCompactionBreakOffsets: number[];
  persistConversationStreamResult: ConversationRuntimeDeps["persistConversationStreamResult"];
  maybeEnqueueTitleGenerationTask: ConversationRuntimeDeps["maybeEnqueueTitleGenerationTask"];
  finalizeConversationViaStreamTask: ConversationRuntimeDeps["finalizeConversationViaStreamTask"];
  setGroupTaskStatusByKind: ConversationRuntimeDeps["setGroupTaskStatusByKind"];
  updateRunningTask: ConversationRuntimeDeps["updateRunningTask"];
  updateChatTaskPayload: ConversationRuntimeDeps["updateChatTaskPayload"];
  updateThread: ConversationRuntimeDeps["updateThread"];
  buildUtilHistorySnapshot: ConversationRuntimeDeps["buildUtilHistorySnapshot"];
}) => {
  const text = streamedText;
  const reasoning = streamedReasoning;

  assertConversationRuntimeHasOutput({
    text,
    reasoning,
    overflowDetected,
  });

  const commandContinuation = continueConversationRuntimeUtilCommandIfNeeded({
    task,
    thread,
    finalResponse,
    text,
    reasoning,
    inRequestCompactionBreakOffsets,
    summaryCallsInCurrentRequest,
    buildUtilHistorySnapshot,
    updateChatTaskPayload,
    setGroupTaskStatusByKind,
    updateRunningTask,
  });
  if (commandContinuation.continued) {
    return true;
  }

  completeConversationRuntimeAfterStreaming({
    task,
    parsedCommand: commandContinuation.parsedCommand,
    text,
    reasoning,
    finalResponse,
    promptMode,
    moodId,
    requestedContextLength,
    continuationCount,
    compactThresholdRatio,
    summaryCallsInCurrentRequest,
    inRequestCompactionBreakOffsets,
    persistConversationStreamResult,
    maybeEnqueueTitleGenerationTask,
    finalizeConversationViaStreamTask,
    setGroupTaskStatusByKind,
    updateThread,
  });

  return true;
};
