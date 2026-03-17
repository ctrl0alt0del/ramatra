import { getConfiguredContextLengthForMode } from "@/lib/lmstudio/context-length";
import { threadRepository } from "@/lib/tasks/chat/adapters/thread-repository";
import { selectExecutionPromptContext } from "@/lib/tasks/chat/handlers/execution-context-selection";
import { resetThreadPromptStateIfNeeded } from "@/lib/tasks/chat/handlers/execution-context-thread-reset";
import { refreshThreadSummaryIfNeeded } from "@/lib/tasks/chat/handlers/execution-context-summary-refresh";
import type { Task, TaskGroup } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export const prepareChatExecutionContext = async ({
  task,
  taskKind,
  getThreadById,
  updateThreadById,
}: {
  task: ChatTask;
  taskKind: Task["kind"];
  getThreadById: (threadId: string) => ReturnType<typeof threadRepository.getById>;
  updateThreadById: (
    threadId: string,
    patch: Record<string, unknown>,
  ) => ReturnType<typeof threadRepository.updateById>;
}) => {
  let thread = task.payload.threadId ? getThreadById(task.payload.threadId) : null;

  const { promptMode, moodId, isPersistentConversation } =
    selectExecutionPromptContext({
      task,
      taskKind,
    });

  thread = resetThreadPromptStateIfNeeded({
    thread,
    taskKind,
    isPersistentConversation,
    promptMode,
    updateThreadById,
  });

  thread = await refreshThreadSummaryIfNeeded({
    task,
    thread,
    taskKind,
    isPersistentConversation,
    promptMode,
    updateThreadById,
  });

  const requestedContextLength =
    typeof task.payload.contextLength === "number" &&
    Number.isFinite(task.payload.contextLength) &&
    task.payload.contextLength > 0
      ? Math.floor(task.payload.contextLength)
      : getConfiguredContextLengthForMode(promptMode, process.env);

  return {
    thread,
    promptMode,
    moodId,
    isPersistentConversation,
    requestedContextLength,
  };
};
