import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import { executeSystemTitleTask } from "@/lib/tasks/chat/handlers/system-title";
import { executeSystemCompactTask } from "@/lib/tasks/chat/handlers/system-compact";
import { threadRepository } from "@/lib/tasks/chat/adapters/thread-repository";
import type { Task, TaskGroup } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export const executeSystemChatTask = async ({
  task,
  taskKind,
  collapseThreadContext,
}: {
  task: ChatTask;
  taskKind: Task["kind"];
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
  if (taskKind === "chat.title") {
    return executeSystemTitleTask({ task });
  }

  if (taskKind === "chat.compact") {
    return executeSystemCompactTask({ task, collapseThreadContext });
  }

  return false;
};
