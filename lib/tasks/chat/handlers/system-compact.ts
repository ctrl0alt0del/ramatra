import { isPromptMode, type PromptMode } from "@/lib/lmstudio/prompt-modes";
import { taskRepository } from "@/lib/tasks/chat/adapters/task-repository";
import { threadRepository } from "@/lib/tasks/chat/adapters/thread-repository";
import type { TaskGroup } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export const executeSystemCompactTask = async ({
  task,
  collapseThreadContext,
}: {
  task: ChatTask;
  collapseThreadContext: (args: {
    threadId: string;
    promptMode: PromptMode;
    interruption?: {
      interrupted: boolean;
      interruptedAssistantTailChars?: string;
      interruptedAssistantFullText?: string;
      interruptionContext?: string;
      toolEventsTranscript?: string;
    };
  }) => Promise<{
    collapsed: boolean;
    thread: ReturnType<typeof threadRepository.getById>;
  }>;
}) => {
  if (task.payload.kind !== "collapse_context") {
    throw new Error("chat.compact task requires collapse_context payload.");
  }

  const thread = threadRepository.getById(task.payload.threadId);
  if (!thread) {
    throw new Error("Thread not found.");
  }

  const rawPromptMode = task.payload.promptMode;
  if (!isPromptMode(rawPromptMode)) {
    throw new Error("A valid promptMode is required.");
  }
  const result = await collapseThreadContext({
    threadId: task.payload.threadId,
    promptMode: rawPromptMode,
    interruption: task.payload.interruption,
  });

  if (result.collapsed && task.payload.interruption?.interrupted) {
    const latestThread = threadRepository.getById(task.payload.threadId);
    if (latestThread) {
      threadRepository.updateById(task.payload.threadId, {
        summaryCallsInCurrentRequest:
          (latestThread.summaryCallsInCurrentRequest ?? 0) + 1,
      });
    }
  }

  taskRepository.updateRunningTask(task.id, {
    result: {
      summaryCollapsed: result.collapsed,
    },
  });

  taskRepository.setGroupTaskStatusByKind({
    taskId: task.id,
    kind: "chat.compact",
    status: "completed",
  });
  return true;
};
