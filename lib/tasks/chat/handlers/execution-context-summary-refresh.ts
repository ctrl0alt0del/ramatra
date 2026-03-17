import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import { generateConversationSummary, shouldRefreshConversationSummary } from "@/lib/lmstudio/summaries";
import { threadRepository } from "@/lib/tasks/chat/adapters/thread-repository";
import type { Task, TaskGroup } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export const refreshThreadSummaryIfNeeded = async ({
  task,
  thread,
  taskKind,
  isPersistentConversation,
  promptMode,
  updateThreadById,
}: {
  task: ChatTask;
  thread: ReturnType<typeof threadRepository.getById>;
  taskKind: Task["kind"];
  isPersistentConversation: boolean;
  promptMode: PromptMode;
  updateThreadById: (
    threadId: string,
    patch: Record<string, unknown>,
  ) => ReturnType<typeof threadRepository.updateById>;
}) => {
  const autoSummaryEnabled = process.env.LM_STUDIO_AUTO_SUMMARY === "true";
  if (
    taskKind !== "chat.generate" ||
    !autoSummaryEnabled ||
    !isPersistentConversation ||
    !thread ||
    !shouldRefreshConversationSummary(thread, promptMode)
  ) {
    return thread;
  }

  try {
    const unsummarizedMessages = thread.messages.slice(thread.summaryMessageCount);
    const conversationSummary = await generateConversationSummary({
      mode: promptMode,
      modelInstanceId: thread.lmstudioModelInstanceId,
      previousSummary: thread.conversationSummary,
      messages: unsummarizedMessages,
    });

    const updatedThread = updateThreadById(thread.id, {
      conversationSummary,
      summaryUpdatedAt: new Date().toISOString(),
      summaryMessageCount: thread.messageCount,
      lmstudioResponseId: null,
    });

    return updatedThread ?? thread;
  } catch (error) {
    console.error("[chat-runner] summary:failed", {
      taskId: task.id,
      threadId: task.payload.threadId ?? null,
      phase: "refresh",
      continuationIndex: 0,
      error,
    });
    return thread;
  }
};
