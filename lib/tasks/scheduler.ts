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
  attachComfyJobToTask,
  createTask,
  detachComfyJob,
  dequeueTask,
  getTaskIdForComfyJob,
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

export const bindComfyJobToTask = (taskId: string, jobId: string) => {
  attachComfyJobToTask(jobId, taskId);

  const task = updateTaskStatus(taskId, {
    result: {
      taskId,
      jobId,
      status: "queued",
      progress: {
        value: null,
        max: null,
        percentage: null,
        node: null,
      },
    },
  });

  if (!task) return null;

  emitUpdatedTask(task);
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
  const task = finishTask(taskId, "completed", { result, error: null });
  const jobId =
    task?.type === "comfy" ? task.result?.jobId ?? null : null;
  if (jobId) {
    detachComfyJob(jobId);
  }
  return task;
};

export const markTaskFailed = (taskId: string, error: string) => {
  const existing = getTask(taskId);
  const task = finishTask(taskId, "failed", { error });
  const jobId =
    existing?.type === "comfy" ? existing.result?.jobId ?? null : null;
  if (jobId) {
    detachComfyJob(jobId);
  }
  return task;
};

export const cancelTask = (taskId: string, error?: string) => {
  dequeueTask(taskId);
  const existing = getTask(taskId);
  const task = finishTask(taskId, "cancelled", {
    error: error ?? null,
  });
  const jobId =
    existing?.type === "comfy" ? existing.result?.jobId ?? null : null;
  if (jobId) {
    detachComfyJob(jobId);
  }
  return task;
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

export const getTaskForComfyJob = (jobId: string) => {
  const taskId = getTaskIdForComfyJob(jobId);
  if (!taskId) return null;
  return getTask(taskId);
};

export const updateComfyTaskForJob = (
  jobId: string,
  input: {
    status?: "queued" | "running" | "completed" | "failed";
    progress?: {
      value: number | null;
      max: number | null;
      percentage: number | null;
      node: string | null;
    };
    error?: string | null;
  },
) => {
  const taskId = getTaskIdForComfyJob(jobId);
  if (!taskId) return null;

  const existing = getTask(taskId);
  if (!existing || existing.type !== "comfy") return null;

  const nextResult = {
    taskId,
    jobId,
    status: input.status ?? existing.result?.status ?? "queued",
    progress:
      input.progress ??
      existing.result?.progress ?? {
        value: null,
        max: null,
        percentage: null,
        node: null,
      },
  };

  if (input.status === "completed") {
    return markTaskCompleted(taskId, nextResult);
  }

  if (input.status === "failed") {
    return markTaskFailed(taskId, input.error ?? "Comfy task failed.");
  }

  const task = updateTaskStatus(taskId, {
    result: nextResult,
    error: input.error ?? undefined,
  });

  if (!task) return null;

  emitUpdatedTask(task);
  emitSchedulerSnapshot();
  return task;
};
