import {
  emitCancelledTask,
  emitCompletedTask,
  emitFailedTask,
  emitGpuChanged,
  emitQueueChanged,
  emitQueuedTask,
  emitStartedTask,
  emitUpdatedTask,
} from "@/lib/tasks/event-bus";
import {
  createTask,
  dequeueTask,
  getSchedulerSnapshot,
  getTask,
  listQueuedTasks,
  setActiveTaskId,
  setGpuMode,
  updateTaskStatus,
} from "@/lib/tasks/store";
import { type Task, type TaskPayloadMap } from "@/lib/tasks/types";

const emitSchedulerSnapshot = () => {
  const snapshot = getSchedulerSnapshot();
  emitQueueChanged(snapshot);
  return snapshot;
};

export const enqueueChatTask = (payload: TaskPayloadMap["chat"]) => {
  const task = createTask("chat", payload);
  emitQueuedTask(task);
  emitSchedulerSnapshot();
  return task;
};

export const enqueueComfyTask = (payload: TaskPayloadMap["comfy"]) => {
  const task = createTask("comfy", payload);
  emitQueuedTask(task);
  emitSchedulerSnapshot();
  return task;
};

export const getNextSchedulableTask = () => {
  const chatQueue = listQueuedTasks("chat").filter(
    (task) => task.status === "queued",
  );
  if (chatQueue.length > 0) {
    return chatQueue[0];
  }

  const comfyQueue = listQueuedTasks("comfy").filter(
    (task) => task.status === "queued",
  );
  return comfyQueue[0] ?? null;
};

export const markTaskStarted = (taskId: string) => {
  dequeueTask(taskId);
  setActiveTaskId(taskId);

  const task = updateTaskStatus(taskId, {
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  });

  if (!task) return null;

  emitStartedTask(task);
  emitSchedulerSnapshot();
  return task;
};

export const updateRunningTask = (
  taskId: string,
  input: {
    result?: Task["result"];
    error?: string | null;
  },
) => {
  const task = updateTaskStatus(taskId, {
    result: input.result ?? undefined,
    error: input.error ?? undefined,
  });

  if (!task) return null;

  emitUpdatedTask(task);
  emitSchedulerSnapshot();
  return task;
};

const finishTask = (
  taskId: string,
  status: "completed" | "failed" | "cancelled",
  input?: {
    result?: Task["result"];
    error?: string | null;
  },
) => {
  const task = updateTaskStatus(taskId, {
    status,
    result: input?.result ?? undefined,
    error:
      input?.error !== undefined
        ? input.error
        : status === "failed"
          ? "Task failed."
          : null,
    finishedAt: new Date().toISOString(),
  });

  if (!task) return null;

  const activeTask = getSchedulerSnapshot().activeTaskId;
  if (activeTask === taskId) {
    setActiveTaskId(null);
  }

  if (status === "completed") {
    emitCompletedTask(task);
  } else if (status === "failed") {
    emitFailedTask(task);
  } else {
    emitCancelledTask(task);
  }

  emitSchedulerSnapshot();
  return task;
};

export const markTaskCompleted = (
  taskId: string,
  result?: Task["result"],
) => {
  return finishTask(taskId, "completed", { result, error: null });
};

export const markTaskFailed = (taskId: string, error: string) => {
  return finishTask(taskId, "failed", { error });
};

export const cancelTask = (taskId: string, error?: string) => {
  dequeueTask(taskId);
  return finishTask(taskId, "cancelled", {
    error: error ?? null,
  });
};

export const setSchedulerGpuMode = (mode: "chat" | "comfy" | "switching") => {
  setGpuMode(mode);
  const snapshot = getSchedulerSnapshot();
  emitGpuChanged(snapshot);
  emitQueueChanged(snapshot);
  return snapshot;
};

export const getSchedulerState = () => {
  return getSchedulerSnapshot();
};

export const getActiveTask = () => {
  const snapshot = getSchedulerSnapshot();
  if (!snapshot.activeTaskId) return null;
  return getTask(snapshot.activeTaskId);
};

export const canRunComfyQueue = () => {
  const snapshot = getSchedulerSnapshot();
  return (
    snapshot.activeTaskId === null &&
    snapshot.queues.chat.every((task) => task.status !== "queued")
  );
};
