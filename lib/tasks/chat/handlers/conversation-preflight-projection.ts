import { shouldCompactForRatio } from "@/lib/tasks/chat/policies/context-budget";
import {
  estimateConversationProjectedTokenUsage,
  resolveConversationTaskForPreflight,
} from "@/lib/tasks/chat/handlers/conversation-preflight-estimate";
import type { TaskGroup } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export const prepareConversationPreflightProjection = ({
  task,
  taskKind,
  thread,
  isPersistentConversation,
  requestedContextLength,
  compactThresholdRatio,
  setSummaryCallsInCurrentRequest,
  updateThread,
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
  isPersistentConversation: boolean;
  requestedContextLength: number;
  compactThresholdRatio: number;
  setSummaryCallsInCurrentRequest: (value: number) => void;
  updateThread: (
    threadId: string,
    patch: { contextWindowUsedTokens?: number | null; contextWindowTotalTokens?: number },
  ) => unknown;
}) => {
  const conversationTask = resolveConversationTaskForPreflight({
    task,
    taskKind,
    isPersistentConversation,
    thread,
  });
  if (!conversationTask || !thread) {
    return {
      shouldDelegateCompaction: false,
      conversationTask: null,
    };
  }

  const continuationIndex = conversationTask.payload.continuationIndex ?? 0;
  if (continuationIndex === 0) {
    setSummaryCallsInCurrentRequest(0);
  }

  const { projectedUsedTokens } = estimateConversationProjectedTokenUsage({
    task: conversationTask,
    thread,
    requestedContextLength,
  });

  if (continuationIndex === 0 && projectedUsedTokens !== null) {
    updateThread(conversationTask.payload.threadId!, {
      contextWindowUsedTokens: projectedUsedTokens,
      contextWindowTotalTokens: requestedContextLength,
    });
  }

  return {
    shouldDelegateCompaction: shouldCompactForRatio({
      usedTokens: projectedUsedTokens,
      totalTokens: requestedContextLength,
      compactThresholdRatio,
    }),
    conversationTask,
  };
};
