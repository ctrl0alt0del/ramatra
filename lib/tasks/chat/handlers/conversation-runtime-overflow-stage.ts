import { handleConversationOverflowContinuation } from "@/lib/tasks/chat/handlers/conversation-continuation";
import { finalizeConversationRuntimeAfterStreaming } from "@/lib/tasks/chat/handlers/conversation-runtime-finalize";
import { computeConversationOverflowMetrics } from "@/lib/tasks/chat/handlers/conversation-overflow-metrics";
import type {
  ChatTask,
  ConversationRuntimeDeps,
  RuntimeThreadSnapshot,
} from "@/lib/tasks/chat/handlers/conversation-runtime.types";
import type { PromptMode } from "@/lib/lmstudio/prompt-modes";

export const executeConversationRuntimeOverflowStage = ({
  task,
  mutableThread,
  promptMode,
  moodId,
  requestedContextLength,
  compactThresholdRatio,
  summaryCallsInCurrentRequest,
  streaming,
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
  mutableThread: RuntimeThreadSnapshot;
  promptMode: PromptMode;
  moodId: string | null;
  requestedContextLength: number;
  compactThresholdRatio: number;
  summaryCallsInCurrentRequest: number;
  streaming: {
    streamedText: string;
    streamedReasoning: string;
    inRequestCompactionBreakOffsets: number[];
    initialAttempt: {
      overflowDetected: boolean;
      usedTokens: number | null;
      finalResponse: import("@/lib/tasks/chat/handlers/conversation-runtime.types").ChatResponse | null;
      toolEventsTranscript: string;
    };
  };
  persistConversationStreamResult: ConversationRuntimeDeps["persistConversationStreamResult"];
  maybeEnqueueTitleGenerationTask: ConversationRuntimeDeps["maybeEnqueueTitleGenerationTask"];
  finalizeConversationViaStreamTask: ConversationRuntimeDeps["finalizeConversationViaStreamTask"];
  setGroupTaskStatusByKind: ConversationRuntimeDeps["setGroupTaskStatusByKind"];
  updateRunningTask: ConversationRuntimeDeps["updateRunningTask"];
  updateChatTaskPayload: ConversationRuntimeDeps["updateChatTaskPayload"];
  updateThread: ConversationRuntimeDeps["updateThread"];
  buildUtilHistorySnapshot: ConversationRuntimeDeps["buildUtilHistorySnapshot"];
}) => {
  const overflowMetrics = computeConversationOverflowMetrics({
    task,
    requestedContextLength,
    initialAttempt: streaming.initialAttempt,
  });

  if (
    handleConversationOverflowContinuation({
      task,
      promptMode,
      moodId,
      requestedContextLength,
      summaryCallsInCurrentRequest,
      continuationCount: overflowMetrics.continuationCount,
      overflowDetected: overflowMetrics.overflowDetected,
      nearLimitDetected: overflowMetrics.nearLimitDetected,
      streamedText: streaming.streamedText,
      streamedReasoning: streaming.streamedReasoning,
      finalResponse: overflowMetrics.finalResponse,
      inRequestCompactionBreakOffsets: streaming.inRequestCompactionBreakOffsets,
      toolEventsTranscript: overflowMetrics.toolEventsTranscript,
    })
  ) {
    return true;
  }

  return finalizeConversationRuntimeAfterStreaming({
    task,
    thread: mutableThread,
    promptMode,
    moodId,
    requestedContextLength,
    compactThresholdRatio,
    continuationCount: overflowMetrics.continuationCount,
    summaryCallsInCurrentRequest,
    finalResponse: overflowMetrics.finalResponse,
    overflowDetected: overflowMetrics.overflowDetected,
    streamedText: streaming.streamedText,
    streamedReasoning: streaming.streamedReasoning,
    inRequestCompactionBreakOffsets: streaming.inRequestCompactionBreakOffsets,
    persistConversationStreamResult,
    maybeEnqueueTitleGenerationTask,
    finalizeConversationViaStreamTask,
    setGroupTaskStatusByKind,
    updateRunningTask,
    updateChatTaskPayload,
    updateThread,
    buildUtilHistorySnapshot,
  });
};
