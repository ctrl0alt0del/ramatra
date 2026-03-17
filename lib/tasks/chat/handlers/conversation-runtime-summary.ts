import type { ChatTask, RuntimeThreadSnapshot } from "@/lib/tasks/chat/handlers/conversation-runtime.types";

export const createConversationRuntimeSummaryState = ({
  task,
  thread,
  isPersistentConversation,
  updateThread,
}: {
  task: ChatTask;
  thread: RuntimeThreadSnapshot;
  isPersistentConversation: boolean;
  updateThread: (
    threadId: string,
    patch:
      | { summaryCallsInCurrentRequest: number }
      | { contextWindowUsedTokens?: number | null; contextWindowTotalTokens?: number },
  ) => unknown;
}) => {
  let mutableThread = thread;
  let summaryCallsInCurrentRequest =
    task.payload.kind === "conversation" &&
    (task.payload.continuationIndex ?? 0) > 0
      ? (mutableThread?.summaryCallsInCurrentRequest ?? 0)
      : 0;

  const setSummaryCallsInCurrentRequest = (value: number) => {
    summaryCallsInCurrentRequest = value;
    if (
      task.payload.kind === "conversation" &&
      task.payload.threadId &&
      isPersistentConversation
    ) {
      const updated = updateThread(task.payload.threadId, {
        summaryCallsInCurrentRequest,
      });
      if (updated) {
        mutableThread = updated as typeof mutableThread;
      }
    }
  };

  const updateThreadAndSync = (
    threadId: string,
    patch:
      | { summaryCallsInCurrentRequest: number }
      | { contextWindowUsedTokens?: number | null; contextWindowTotalTokens?: number },
  ) => {
    const updated = updateThread(threadId, patch);
    if (updated && mutableThread && threadId === task.payload.threadId) {
      mutableThread = updated as typeof mutableThread;
    }
    return updated;
  };

  return {
    getThread: () => mutableThread,
    getSummaryCallsInCurrentRequest: () => summaryCallsInCurrentRequest,
    setSummaryCallsInCurrentRequest,
    updateThreadAndSync,
  };
};
