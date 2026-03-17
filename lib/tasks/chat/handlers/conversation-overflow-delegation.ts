import { formatContextCompactionDuringRequestMarker } from "@/lib/chat/context-compaction-marker";
import { hasTaskByKind } from "@/lib/tasks/chat/guards";
import { buildContinuationConversationPayload } from "@/lib/tasks/chat/handlers/conversation-task-builders";
import { buildOverflowInterruptionPayload } from "@/lib/tasks/chat/handlers/conversation-overflow-interruption";
import { taskOrchestration } from "@/lib/tasks/chat/adapters/task-orchestration";
import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import type { TaskGroup } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;
type ConversationPayload = Extract<ChatTask["payload"], { kind: "conversation" }>;

export const delegateOverflowContinuation = ({
  task,
  conversationPayload,
  promptMode,
  moodId,
  requestedContextLength,
  summaryCallsInCurrentRequest,
  continuationCount,
  streamedText,
  streamedReasoning,
  finalResponseId,
  inRequestCompactionBreakOffsets,
  toolEventsTranscript,
  overflowDetected,
  orchestration = taskOrchestration,
}: {
  task: ChatTask;
  conversationPayload: ConversationPayload;
  promptMode: PromptMode;
  moodId: string | null;
  requestedContextLength: number;
  summaryCallsInCurrentRequest: number;
  continuationCount: number;
  streamedText: string;
  streamedReasoning: string;
  finalResponseId: string | null;
  inRequestCompactionBreakOffsets: number[];
  toolEventsTranscript: string;
  overflowDetected: boolean;
  orchestration?: Pick<
    typeof taskOrchestration,
    "enqueueChatTask" | "transferTaskByKind" | "markTaskCompleted"
  >;
}) => {
  const nextContinuationIndex = continuationCount + 1;
  const breakOffset = streamedText.length;
  if (
    breakOffset > 0 &&
    (inRequestCompactionBreakOffsets.length === 0 ||
      inRequestCompactionBreakOffsets.at(-1) !== breakOffset)
  ) {
    inRequestCompactionBreakOffsets.push(breakOffset);
  }

  const compactTask = orchestration.enqueueChatTask({
    kind: "collapse_context",
    threadId: conversationPayload.threadId!,
    promptMode,
    moodId,
    contextLength: requestedContextLength * 2,
    interruption: buildOverflowInterruptionPayload({
      streamedText,
      overflowDetected,
      toolEventsTranscript,
    }),
  });

  const textWithCompactionMarkers = [
    streamedText,
    formatContextCompactionDuringRequestMarker(nextContinuationIndex),
  ]
    .filter(Boolean)
    .join("");

  const continuationTask = orchestration.enqueueChatTask(
    buildContinuationConversationPayload({
      sourcePayload: conversationPayload,
      promptMode,
      moodId,
      contextLength: requestedContextLength,
      continuationIndex: nextContinuationIndex,
      carryoverText: textWithCompactionMarkers,
      carryoverReasoning: streamedReasoning,
    }),
  );

  if (hasTaskByKind(conversationPayload.tasks, "chat.stream")) {
    orchestration.transferTaskByKind({
      fromTaskId: task.id,
      toTaskId: continuationTask.id,
      taskKind: "chat.stream",
      nextStatus: "pending",
    });
  }

  orchestration.markTaskCompleted(task.id, {
    text: textWithCompactionMarkers,
    reasoning: streamedReasoning,
    responseId: finalResponseId,
    summaryCallsInCurrentRequest,
    delegatedToTaskGroupId: continuationTask.id,
  });

  return {
    compactTaskGroupId: compactTask.id,
    continuationTaskGroupId: continuationTask.id,
    continuationIndex: nextContinuationIndex,
  };
};
