import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import { threadRepository } from "@/lib/tasks/chat/adapters/thread-repository";
import type { Task } from "@/lib/tasks/types";

export const resetThreadPromptStateIfNeeded = ({
  thread,
  taskKind,
  isPersistentConversation,
  promptMode,
  updateThreadById,
}: {
  thread: ReturnType<typeof threadRepository.getById>;
  taskKind: Task["kind"];
  isPersistentConversation: boolean;
  promptMode: PromptMode;
  updateThreadById: (
    threadId: string,
    patch: Record<string, unknown>,
  ) => ReturnType<typeof threadRepository.updateById>;
}) => {
  const shouldResetPromptState =
    taskKind === "chat.generate" &&
    isPersistentConversation &&
    thread !== null &&
    thread.lmstudioResponseId !== null &&
    (thread.lastPromptMode === null || thread.lastPromptMode !== promptMode);

  if (!shouldResetPromptState || !thread) {
    return thread;
  }

  const updatedThread = updateThreadById(thread.id, {
    lmstudioResponseId: null,
    lastPromptMode: promptMode,
    conversationSummary: null,
    summaryUpdatedAt: null,
    summaryMessageCount: 0,
  });

  return updatedThread ?? thread;
};
