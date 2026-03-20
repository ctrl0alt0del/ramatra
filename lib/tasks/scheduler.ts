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
import { clearPendingComfyStreamSession } from "@/lib/tasks/comfy-stream-session";
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
  updateTaskPayload,
  updateTaskStatus,
} from "@/lib/tasks/store";
import {
  type Task,
  type TaskExecutionStatus,
  type TaskGroup,
  type TaskGroupPayloadMap,
} from "@/lib/tasks/types";

const logTaskOrchestration = (phase: string, payload: Record<string, unknown>) => {
  console.info(`[task-orch] ${phase}`, payload);
};

const emitSchedulerSnapshot = () => {
  const snapshot = getSchedulerSnapshot();
  emitQueueChanged(snapshot);
  return snapshot;
};

const isBackgroundChatTaskKind = (kind: TaskGroupPayloadMap["chat"]["kind"]) => {
  return kind === "generate_title" || kind === "update_intent";
};

const withDefaultTasks = <TType extends keyof TaskGroupPayloadMap>(
  type: TType,
  payload: TaskGroupPayloadMap[TType],
): TaskGroupPayloadMap[TType] => {
  if (type === "chat") {
    const chatPayload = payload as TaskGroupPayloadMap["chat"];
    if (chatPayload.tasks?.length) {
      return payload;
    }

    const tasks: Task[] =
      chatPayload.kind === "conversation"
        ? [
            {
              id: crypto.randomUUID(),
              kind: "chat.generate",
              status: "pending",
            },
            {
              id: crypto.randomUUID(),
              kind: "chat.stream",
              status: "pending",
            },
          ]
        : chatPayload.kind === "critique"
          ? [
              {
                id: crypto.randomUUID(),
                kind: "chat.unbiased_critique",
                status: "pending",
              },
              {
                id: crypto.randomUUID(),
                kind: "chat.biased_critique",
                status: "pending",
              },
              {
                id: crypto.randomUUID(),
                kind: "chat.stream",
                status: "pending",
              },
            ]
          : chatPayload.kind === "update_intent"
            ? [
                {
                  id: crypto.randomUUID(),
                  kind: "chat.intent",
                  status: "pending",
                },
              ]
        : chatPayload.kind === "generate_title"
          ? [
              {
                id: crypto.randomUUID(),
                kind: "chat.title",
                status: "pending",
              },
            ]
          : [
              {
                id: crypto.randomUUID(),
                kind: "chat.compact",
                status: "pending",
              },
            ];

    return {
      ...chatPayload,
      tasks,
    } as TaskGroupPayloadMap[TType];
  }

  const comfyPayload = payload as TaskGroupPayloadMap["comfy"];
  if (comfyPayload.tasks?.length) {
    return payload;
  }

  return {
    ...comfyPayload,
    tasks: [
      {
        id: crypto.randomUUID(),
        kind: "image.generate",
        status: "pending",
      },
      {
        id: crypto.randomUUID(),
        kind: "image.stream",
        status: "pending",
      },
    ],
  } as TaskGroupPayloadMap[TType];
};

export const enqueueChatTask = (payload: TaskGroupPayloadMap["chat"]) => {
  const task = createTask("chat", withDefaultTasks("chat", payload));
  emitQueuedTask(task);
  emitSchedulerSnapshot();
  return task;
};

export const enqueueComfyTask = (payload: TaskGroupPayloadMap["comfy"]) => {
  const task = createTask("comfy", withDefaultTasks("comfy", payload));
  emitQueuedTask(task);
  emitSchedulerSnapshot();
  return task;
};

export const transferTaskByKind = ({
  fromTaskId,
  toTaskId,
  taskKind,
  nextStatus,
}: {
  fromTaskId: string;
  toTaskId: string;
  taskKind: Task["kind"];
  nextStatus?: TaskExecutionStatus;
}) => {
  const fromTask = getTask(fromTaskId);
  const toTask = getTask(toTaskId);
  if (
    !fromTask ||
    !toTask ||
    fromTask.type !== "chat" ||
    toTask.type !== "chat"
  ) {
    return null;
  }

  const fromTasks = fromTask.payload.tasks ?? [];
  const movingTask = fromTasks.find((item) => item.kind === taskKind);
  if (!movingTask) {
    return null;
  }
  const normalizedMovingTask =
    nextStatus && movingTask.status !== nextStatus
      ? { ...movingTask, status: nextStatus }
      : movingTask;

  const nextFrom = updateTaskPayload(fromTaskId, {
    ...fromTask.payload,
    tasks: fromTasks.filter((item) => item.kind !== taskKind),
  });
  const nextTo = updateTaskPayload(toTaskId, {
    ...toTask.payload,
    tasks: [...(toTask.payload.tasks ?? []), normalizedMovingTask],
  });

  if (nextFrom) {
    emitUpdatedTask(nextFrom);
  }
  if (nextTo) {
    emitUpdatedTask(nextTo);
  }
  if (nextFrom && nextTo) {
    logTaskOrchestration("task:transfer", {
      fromTaskGroupId: fromTaskId,
      toTaskGroupId: toTaskId,
      taskKind,
      taskId: normalizedMovingTask.id,
      nextStatus: normalizedMovingTask.status,
    });
  }
  if (nextFrom || nextTo) {
    emitSchedulerSnapshot();
  }

  return nextFrom && nextTo
    ? { fromTask: nextFrom, toTask: nextTo }
    : null;
};

export const updateChatTaskPayload = (
  taskId: string,
  payload: TaskGroupPayloadMap["chat"],
) => {
  const existing = getTask(taskId);
  if (!existing || existing.type !== "chat") {
    return null;
  }

  const updated = updateTaskPayload(taskId, payload);
  if (!updated || updated.type !== "chat") {
    return null;
  }

  emitUpdatedTask(updated);
  emitSchedulerSnapshot();
  return updated;
};
export const setGroupTaskStatusByKind = ({
  taskId,
  kind,
  status,
}: {
  taskId: string;
  kind: Task["kind"];
  status: TaskExecutionStatus;
}) => {
  const task = getTask(taskId);
  if (!task) {
    return null;
  }

  const groupTasks = task.payload.tasks ?? [];
  const index = groupTasks.findIndex((item) => item.kind === kind);
  if (index === -1) {
    return task;
  }

  if (groupTasks[index]?.status === status) {
    return task;
  }
  const previousStatus = groupTasks[index]?.status ?? null;
  const innerTaskId = groupTasks[index]?.id ?? null;

  const nextTasks = groupTasks.map((item, itemIndex) =>
    itemIndex === index ? { ...item, status } : item,
  );
  const updated = updateTaskPayload(taskId, {
    ...task.payload,
    tasks: nextTasks,
  });
  if (!updated) {
    return null;
  }

  emitUpdatedTask(updated);
  logTaskOrchestration("task:status", {
    taskGroupId: taskId,
    taskId: innerTaskId,
    kind,
    from: previousStatus,
    to: status,
  });
  emitSchedulerSnapshot();
  return updated;
};

export const getNextRunnableGroupTask = (taskId: string) => {
  const task = getTask(taskId);
  if (!task) {
    return null;
  }

  const running = (task.payload.tasks ?? []).find(
    (groupTask) => groupTask.status === "running",
  );
  if (running) {
    return { task, groupTask: running };
  }

  const pending = (task.payload.tasks ?? []).find(
    (groupTask) => groupTask.status === "pending",
  );
  if (!pending) {
    return null;
  }

  const updated = setGroupTaskStatusByKind({
    taskId,
    kind: pending.kind,
    status: "running",
  });
  if (!updated) {
    return null;
  }

  const startedTask = (updated.payload.tasks ?? []).find(
    (groupTask) =>
      groupTask.kind === pending.kind && groupTask.status === "running",
  );
  if (!startedTask) {
    return null;
  }

  return { task: updated, groupTask: startedTask };
};

export const bindComfyJobToTask = (taskId: string, jobId: string) => {
  attachComfyJobToTask(jobId, taskId);

  const task = updateTaskStatus(taskId, {
    result: {
      taskId,
      jobId,
      status: "running",
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
  const foregroundChatQueue = chatQueue.filter(
    (task) => !isBackgroundChatTaskKind(task.payload.kind),
  );
  if (foregroundChatQueue.length > 0) {
    return foregroundChatQueue[0];
  }

  const comfyQueue = listQueuedTasks("comfy").filter(
    (task) => task.status === "queued",
  );
  if (comfyQueue.length > 0) {
    return comfyQueue[0];
  }

  const backgroundChatQueue = chatQueue.filter(
    (task) => isBackgroundChatTaskKind(task.payload.kind),
  );
  return backgroundChatQueue[0] ?? null;
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
    result?: TaskGroup["result"];
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
    result?: TaskGroup["result"];
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
  result?: TaskGroup["result"],
) => {
  const task = finishTask(taskId, "completed", { result, error: null });
  clearPendingComfyStreamSession(taskId);
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
  clearPendingComfyStreamSession(taskId);
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
  clearPendingComfyStreamSession(taskId);
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

export const hasPendingTitleGenerationTask = (threadId: string) => {
  const activeTask = getActiveTask();
  if (
    activeTask?.type === "chat" &&
    activeTask.payload.kind === "generate_title" &&
    activeTask.payload.threadId === threadId
  ) {
    return true;
  }

  const queuedChatTasks = listQueuedTasks("chat").filter(
    (task) => task.status === "queued",
  );

  return queuedChatTasks.some(
    (task) =>
      task.payload.kind === "generate_title" &&
      task.payload.threadId === threadId,
  );
};

export const canRunComfyQueue = () => {
  const snapshot = getSchedulerSnapshot();
  const hasQueuedForegroundChatTasks = snapshot.queues.chat.some(
    (task) =>
      task.type === "chat" &&
      task.status === "queued" &&
      !isBackgroundChatTaskKind(task.payload.kind),
  );
  return (
    snapshot.activeTaskId === null &&
    !hasQueuedForegroundChatTasks
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
  if (!taskId) {
    if (input.status === "failed") {
      console.error("[comfy-runner] image.stream:failed-unmapped-job", {
        jobId,
        error: input.error ?? null,
      });
    }
    return null;
  }

  const existing = getTask(taskId);
  if (!existing || existing.type !== "comfy") {
    if (input.status === "failed") {
      console.error("[comfy-runner] image.stream:failed-noncomfy-task", {
        jobId,
        taskId,
        error: input.error ?? null,
      });
    }
    return null;
  }

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

  if (input.status === "running") {
    setGroupTaskStatusByKind({
      taskId,
      kind: "image.stream",
      status: "running",
    });
  } else if (input.status === "completed") {
    setGroupTaskStatusByKind({
      taskId,
      kind: "image.stream",
      status: "completed",
    });
    clearPendingComfyStreamSession(taskId);
  } else if (input.status === "failed") {
    console.error("[comfy-runner] image.stream:failed", {
      taskGroupId: taskId,
      jobId,
      error: input.error ?? null,
      previousResult: existing.result ?? null,
    });
    setGroupTaskStatusByKind({
      taskId,
      kind: "image.stream",
      status: "failed",
    });
    clearPendingComfyStreamSession(taskId);
  }

  const task = updateTaskStatus(taskId, {
    result: nextResult,
    error:
      input.status === "failed"
        ? (input.error ?? "Comfy task failed.")
        : (input.error ?? undefined),
  });

  if (!task) return null;

  emitUpdatedTask(task);
  emitSchedulerSnapshot();
  return task;
};

