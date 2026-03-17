import {
  formatUnknownError,
  logChatModelDebug,
} from "@/lib/tasks/chat/logging";
import { applyChatFailureTransitions } from "@/lib/tasks/chat/handlers/failure";
import { cleanupChatTaskLmStudioState } from "@/lib/tasks/chat/handlers/cleanup";
import { runChatTaskPipeline } from "@/lib/tasks/chat/handlers/run-chat-task";
import { createRunChatTaskPipelineDeps } from "@/lib/tasks/chat/handlers/run-chat-task-deps";
import { threadRepository } from "@/lib/tasks/chat/adapters/thread-repository";
import { taskRepository } from "@/lib/tasks/chat/adapters/task-repository";
import { processTaskQueues } from "@/lib/tasks/processor";
import type { Task } from "@/lib/tasks/types";

export const executeQueuedChatTask = async (
  taskId: string,
  taskKind: Task["kind"],
) => {
  const runChatTaskPipelineDeps = createRunChatTaskPipelineDeps();
  const task = taskRepository.getById(taskId);
  if (!task || task.type !== "chat") {
    return;
  }

  try {
    if (
      await runChatTaskPipeline({
        task,
        taskKind,
        ...runChatTaskPipelineDeps,
      })
    ) {
      return;
    }
  } catch (error) {
    console.error("[chat-runner] task:failed", {
      taskId: task.id,
      taskKind,
      threadId: task.payload.threadId ?? null,
      error: formatUnknownError(error),
    });
    applyChatFailureTransitions({
      task,
      taskKind,
      setGroupTaskStatusByKind: taskRepository.setGroupTaskStatusByKind,
      updateThread: threadRepository.updateById,
    });
    taskRepository.markFailed(
      taskId,
      error instanceof Error ? error.message : "Chat task failed.",
    );
  } finally {
    await cleanupChatTaskLmStudioState({
      taskId,
      getChatModelKey: runChatTaskPipelineDeps.getChatModelKey,
      logChatModelDebug,
    });

    void processTaskQueues();
  }
};

