import { taskOrchestration } from "@/lib/tasks/chat/adapters/task-orchestration";
import { prepareConversationPreflightProjection } from "@/lib/tasks/chat/handlers/conversation-preflight-projection";
import { delegateConversationPreflightCompaction } from "@/lib/tasks/chat/handlers/conversation-preflight-delegation";
import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import type { TaskGroup } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export const executeConversationPreflightCompaction = ({
  task,
  taskKind,
  thread,
  promptMode,
  moodId,
  requestedContextLength,
  isPersistentConversation,
  summaryCallsInCurrentRequest,
  compactThresholdRatio,
  setSummaryCallsInCurrentRequest,
  updateThread,
  orchestration = taskOrchestration,
}: {
  task: ChatTask;
  taskKind: "chat.generate" | "chat.stream";
  thread:
    | {
        messages: Array<{
          role: "user" | "assistant" | "system";
          content: import("@/lib/chat/message-content").MessagePart[];
        }>;
        contextWindowUsedTokens: number | null;
      }
    | null;
  promptMode: PromptMode;
  moodId: string | null;
  requestedContextLength: number;
  isPersistentConversation: boolean;
  summaryCallsInCurrentRequest: number;
  compactThresholdRatio: number;
  setSummaryCallsInCurrentRequest: (value: number) => void;
  updateThread: (
    threadId: string,
    patch: { contextWindowUsedTokens?: number | null; contextWindowTotalTokens?: number },
  ) => unknown;
  orchestration?: Pick<
    typeof taskOrchestration,
    "enqueueChatTask" | "transferTaskByKind" | "markTaskCompleted"
  >;
}) => {
  const projection = prepareConversationPreflightProjection({
    task,
    taskKind,
    thread,
    isPersistentConversation,
    requestedContextLength,
    compactThresholdRatio,
    setSummaryCallsInCurrentRequest,
    updateThread,
  });
  if (projection.shouldDelegateCompaction && projection.conversationTask) {
    const { conversationTask } = projection;
    const delegated = delegateConversationPreflightCompaction({
      task: conversationTask,
      promptMode,
      moodId,
      requestedContextLength,
      summaryCallsInCurrentRequest,
      orchestration,
    });

    console.info("[chat-runner] summary:triggered", {
      taskId: delegated.compactTaskId,
      threadId: conversationTask.payload.threadId,
      phase: "before",
      continuationIndex: conversationTask.payload.continuationIndex ?? 0,
    });
    return { delegated: true };
  }

  return { delegated: false };
};
