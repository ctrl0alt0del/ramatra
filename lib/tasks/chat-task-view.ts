import { getTask } from "@/lib/tasks/store";

export type ChatTaskView =
  | {
      taskId: string;
      status: "queued" | "running";
      text: string;
      reasoning: string;
      responseId: string | null;
      summaryCallsInCurrentRequest: number;
    }
  | {
      taskId: string;
      status: "completed";
      text: string;
      reasoning: string;
      responseId: string | null;
      summaryCallsInCurrentRequest: number;
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
  };
};
