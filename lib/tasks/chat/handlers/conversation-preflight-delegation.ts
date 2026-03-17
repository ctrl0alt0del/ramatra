import { hasTaskByKind } from "@/lib/tasks/chat/guards";
import { taskOrchestration } from "@/lib/tasks/chat/adapters/task-orchestration";
import { buildContinuationConversationPayload } from "@/lib/tasks/chat/handlers/conversation-task-builders";
import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import type { TaskGroup } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;
type ConversationTask = ChatTask & {
  payload: Extract<ChatTask["payload"], { kind: "conversation" }>;
};

export const delegateConversationPreflightCompaction = ({
  task,
  promptMode,
  moodId,
  requestedContextLength,
  summaryCallsInCurrentRequest,
  orchestration = taskOrchestration,
}: {
  task: ConversationTask;
  promptMode: PromptMode;
  moodId: string | null;
  requestedContextLength: number;
  summaryCallsInCurrentRequest: number;
  orchestration?: Pick<
    typeof taskOrchestration,
    "enqueueChatTask" | "transferTaskByKind" | "markTaskCompleted"
  >;
}) => {
  const compactTask = orchestration.enqueueChatTask({
    kind: "collapse_context",
    threadId: task.payload.threadId!,
    promptMode,
    moodId,
    contextLength: requestedContextLength * 2,
  });
  const continuationTask = orchestration.enqueueChatTask(
    buildContinuationConversationPayload({
      sourcePayload: task.payload,
      promptMode,
      moodId,
      contextLength: requestedContextLength,
      continuationIndex: task.payload.continuationIndex ?? 0,
      carryoverText: task.payload.carryoverText,
      carryoverReasoning: task.payload.carryoverReasoning,
    }),
  );
  if (hasTaskByKind(task.payload.tasks, "chat.stream")) {
    orchestration.transferTaskByKind({
      fromTaskId: task.id,
      toTaskId: continuationTask.id,
      taskKind: "chat.stream",
      nextStatus: "pending",
    });
  }
  orchestration.markTaskCompleted(task.id, {
    text: task.payload.carryoverText ?? "",
    reasoning: task.payload.carryoverReasoning ?? "",
    responseId: null,
    summaryCallsInCurrentRequest,
    delegatedToTaskGroupId: continuationTask.id,
  });

  return {
    compactTaskId: compactTask.id,
    continuationTaskId: continuationTask.id,
  };
};
