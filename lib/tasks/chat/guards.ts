import type { Task, TaskGroup } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export const hasTaskByKind = (
  tasks:
    | Array<{
        id: string;
        kind: string;
      }>
    | undefined,
  kind: string,
) => {
  return tasks?.some((item) => item.kind === kind) ?? false;
};

export const assertChatRunnableShape = ({
  taskKind,
  task,
}: {
  taskKind: Task["kind"];
  task: ChatTask;
}) => {
  const groupTasks = task.payload.tasks ?? [];

  if (
    taskKind !== "chat.generate" &&
    taskKind !== "chat.intent" &&
    taskKind !== "chat.unbiased_critique" &&
    taskKind !== "chat.biased_critique" &&
    taskKind !== "chat.stream"
  ) {
    throw new Error(`Unsupported runnable chat task kind: ${taskKind}`);
  }
  if (
    task.payload.kind !== "conversation" &&
    task.payload.kind !== "critique" &&
    task.payload.kind !== "update_intent"
  ) {
    throw new Error("Unsupported payload kind for chat runnable task.");
  }
  if (task.payload.kind === "conversation") {
    if (!hasTaskByKind(groupTasks, "chat.generate")) {
      throw new Error("Missing chat.generate task.");
    }
    if (!hasTaskByKind(groupTasks, "chat.stream")) {
      throw new Error("Missing chat.stream task.");
    }
    if (
      taskKind === "chat.unbiased_critique" ||
      taskKind === "chat.biased_critique" ||
      taskKind === "chat.intent"
    ) {
      throw new Error("This task kind requires a non-conversation payload.");
    }
  } else if (task.payload.kind === "critique") {
    if (!hasTaskByKind(groupTasks, "chat.unbiased_critique")) {
      throw new Error("Missing chat.unbiased_critique task.");
    }
    if (!hasTaskByKind(groupTasks, "chat.biased_critique")) {
      throw new Error("Missing chat.biased_critique task.");
    }
    if (!hasTaskByKind(groupTasks, "chat.stream")) {
      throw new Error("Missing chat.stream task.");
    }
    if (taskKind === "chat.generate" || taskKind === "chat.intent") {
      throw new Error("This task kind requires a different payload.");
    }
  } else {
    if (!hasTaskByKind(groupTasks, "chat.intent")) {
      throw new Error("Missing chat.intent task.");
    }
    if (
      taskKind === "chat.generate" ||
      taskKind === "chat.stream" ||
      taskKind === "chat.unbiased_critique" ||
      taskKind === "chat.biased_critique"
    ) {
      throw new Error("This task kind requires a different payload.");
    }
  }
};
