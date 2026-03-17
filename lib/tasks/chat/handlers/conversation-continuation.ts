import { getChatStopSignals, getUsedContextTokens } from "@/lib/tasks/chat/policies/stream-stop";
import { taskOrchestration } from "@/lib/tasks/chat/adapters/task-orchestration";
import { delegateOverflowContinuation } from "@/lib/tasks/chat/handlers/conversation-overflow-delegation";
import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import type { TaskGroup } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export const handleConversationOverflowContinuation = ({
  task,
  promptMode,
  moodId,
  requestedContextLength,
  summaryCallsInCurrentRequest,
  continuationCount,
  overflowDetected,
  nearLimitDetected,
  streamedText,
  streamedReasoning,
  finalResponse,
  inRequestCompactionBreakOffsets,
  toolEventsTranscript,
  orchestration = taskOrchestration,
}: {
  task: ChatTask;
  promptMode: PromptMode;
  moodId: string | null;
  requestedContextLength: number;
  summaryCallsInCurrentRequest: number;
  continuationCount: number;
  overflowDetected: boolean;
  nearLimitDetected: boolean;
  streamedText: string;
  streamedReasoning: string;
  finalResponse: {
    response_id?: string | null;
    finish_reason?: string;
    stop_reason?: string;
    usage?: Record<string, unknown>;
    stats?: Record<string, unknown>;
  } | null;
  inRequestCompactionBreakOffsets: number[];
  toolEventsTranscript: string;
  orchestration?: Pick<
    typeof taskOrchestration,
    "enqueueChatTask" | "transferTaskByKind" | "markTaskCompleted"
  >;
}) => {
  if (
    !(overflowDetected || nearLimitDetected) ||
    task.payload.kind !== "conversation" ||
    !task.payload.threadId
  ) {
    return false;
  }

  const MAX_OVERFLOW_CONTINUATIONS_PER_TASK = 8;
  if (continuationCount >= MAX_OVERFLOW_CONTINUATIONS_PER_TASK) {
    console.error("[chat-runner] reached continuation safety cap", {
      taskId: task.id,
      threadId: task.payload.threadId,
      continuationCount,
      usedTokens: getUsedContextTokens(finalResponse),
      totalTokens: requestedContextLength,
    });
    return false;
  }

  const overflowSignals = getChatStopSignals(finalResponse);
  console.info("[chat-runner] overflow:detected", {
    taskId: task.id,
    threadId: task.payload.threadId,
    stopReason: overflowSignals.stopReason,
    finishReason: overflowSignals.finishReason,
    usedTokens: getUsedContextTokens(finalResponse),
    totalTokens: requestedContextLength,
    continuationIndex: continuationCount + 1,
    nearLimitDetected,
  });

  const delegated = delegateOverflowContinuation({
    task,
    conversationPayload: task.payload,
    promptMode,
    moodId,
    requestedContextLength,
    summaryCallsInCurrentRequest,
    continuationCount,
    streamedText,
    streamedReasoning,
    finalResponseId: finalResponse?.response_id ?? null,
    inRequestCompactionBreakOffsets,
    toolEventsTranscript,
    overflowDetected,
    orchestration,
  });
  console.info("[chat-runner] overflow:delegated", {
    sourceTaskGroupId: task.id,
    compactTaskGroupId: delegated.compactTaskGroupId,
    continuationTaskGroupId: delegated.continuationTaskGroupId,
    threadId: task.payload.threadId,
    continuationIndex: delegated.continuationIndex,
  });
  console.info("[chat-runner] summary:triggered", {
    taskId: delegated.compactTaskGroupId,
    threadId: task.payload.threadId,
    phase: "after",
    continuationIndex: delegated.continuationIndex,
  });
  return true;
};
