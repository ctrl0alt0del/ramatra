import { getConfiguredContextLengthForMode } from "@/lib/lmstudio/context-length";
import {
  defaultPromptMode,
  isPromptMode,
} from "@/lib/lmstudio/prompt-modes";
import { threadRepository } from "@/lib/tasks/chat/adapters/thread-repository";
import { taskOrchestration } from "@/lib/tasks/chat/adapters/task-orchestration";

export const maybeEnqueueTitleGenerationTask = (threadId: string) => {
  const thread = threadRepository.getById(threadId);
  if (!thread) {
    return;
  }

  if (thread.titleGenerated && !threadRepository.isPlaceholderTitle(thread.title)) {
    return;
  }

  if (taskOrchestration.hasPendingTitleGenerationTask(threadId)) {
    return;
  }

  taskOrchestration.enqueueChatTask({
    kind: "generate_title",
    threadId,
    contextLength: getConfiguredContextLengthForMode(
      thread.lastPromptMode && isPromptMode(thread.lastPromptMode)
        ? thread.lastPromptMode
        : defaultPromptMode,
      process.env,
    ),
  });
};
