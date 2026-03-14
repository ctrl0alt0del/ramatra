import { getTask, listAllTasks } from "@/lib/tasks/store";

export type ChatTaskView =
  | {
      taskId: string;
      status: "queued" | "running";
      text: string;
      reasoning: string;
      responseId: string | null;
      summaryCallsInCurrentRequest: number;
      delegatedToTaskGroupId?: string;
    }
  | {
      taskId: string;
      status: "completed";
      text: string;
      reasoning: string;
      responseId: string | null;
      summaryCallsInCurrentRequest: number;
      delegatedToTaskGroupId?: string;
    }
  | {
      taskId: string;
      status: "failed";
      error: string;
    };

export const getChatTaskView = (taskId: string): ChatTaskView | null => {
  const task = getTask(taskId);
  if (!task || task.type !== "chat") {
    return null;
  }

  if (task.status === "failed" || task.status === "cancelled") {
    return {
      taskId,
      status: "failed",
      error: task.error ?? "Chat task failed.",
    };
  }

  return {
    taskId,
    status: task.status === "completed" ? "completed" : task.status,
    text: task.result?.text ?? "",
    reasoning: task.result?.reasoning ?? "",
    responseId: task.result?.responseId ?? null,
    summaryCallsInCurrentRequest: task.result?.summaryCallsInCurrentRequest ?? 0,
    delegatedToTaskGroupId:
      task.result &&
      typeof task.result === "object" &&
      "delegatedToTaskGroupId" in task.result &&
      typeof task.result.delegatedToTaskGroupId === "string"
        ? task.result.delegatedToTaskGroupId
        : undefined,
  };
};

const findChatTaskGroupIdByStreamTaskId = (streamTaskId: string) => {
  const all = listAllTasks()
    .filter((task) => task.type === "chat")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  const owner = all.findLast((task) =>
    (task.payload.tasks ?? []).some(
      (groupTask) => groupTask.id === streamTaskId && groupTask.kind === "chat.stream",
    ),
  );

  return owner?.id ?? null;
};

export const getChatTaskViewByStreamTaskId = (
  streamTaskId: string,
): ChatTaskView | null => {
  const ownerGroupId = findChatTaskGroupIdByStreamTaskId(streamTaskId);
  if (!ownerGroupId) {
    const direct = getChatTaskView(streamTaskId);
    if (!direct) {
      return null;
    }
    return {
      ...direct,
      taskId: streamTaskId,
    };
  }

  const view = getChatTaskView(ownerGroupId);
  if (!view) {
    return null;
  }

  return {
    ...view,
    taskId: streamTaskId,
  };
};
