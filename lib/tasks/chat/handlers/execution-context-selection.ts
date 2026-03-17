import { defaultPromptMode, isPromptMode, type PromptMode } from "@/lib/lmstudio/prompt-modes";
import type { Task, TaskGroup } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export const selectExecutionPromptContext = ({
  task,
  taskKind,
}: {
  task: ChatTask;
  taskKind: Task["kind"];
}) => {
  const promptMode: PromptMode =
    task.payload.kind === "conversation"
      ? task.payload.promptMode && isPromptMode(task.payload.promptMode)
        ? task.payload.promptMode
        : defaultPromptMode
      : task.payload.kind === "critique"
        ? "artist"
        : "regular";

  const moodId =
    task.payload.kind === "conversation" || task.payload.kind === "critique"
      ? (task.payload.moodId ?? null)
      : null;
  const isPersistentConversation =
    task.payload.kind === "conversation" ? task.payload.persistent !== false : false;

  return {
    promptMode,
    moodId,
    isPersistentConversation,
    isGenerateTask: taskKind === "chat.generate",
  };
};
