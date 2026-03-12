import {
  type GpuMode,
  type SchedulerSnapshot,
  type Task,
  type TaskPayloadMap,
  type TaskQueueSnapshot,
  type TaskResultMap,
  type TaskStatus,
  type TaskType,
} from "@/lib/tasks/types";

type TaskStoreState = {
  tasks: Map<string, Task>;
  chatQueue: string[];
  comfyQueue: string[];
  activeTaskId: string | null;
  gpuMode: GpuMode;
  comfyJobToTaskId: Map<string, string>;
  lastError: string | null;
};

declare global {
  var __comfyBridgeTaskStore: TaskStoreState | undefined;
}

const getState = () => {
  if (!globalThis.__comfyBridgeTaskStore) {
    globalThis.__comfyBridgeTaskStore = {
      tasks: new Map<string, Task>(),
      chatQueue: [],
      comfyQueue: [],
      activeTaskId: null,
      gpuMode: "chat",
      comfyJobToTaskId: new Map<string, string>(),
      lastError: null,
    };
  }

  return globalThis.__comfyBridgeTaskStore;
};

const getQueueForType = (state: TaskStoreState, type: TaskType) => {
  return type === "chat" ? state.chatQueue : state.comfyQueue;
};

const cloneQueue = (state: TaskStoreState, queueIds: string[]) => {
  return queueIds
    .map((taskId) => state.tasks.get(taskId))
    .filter((task): task is Task => Boolean(task));
};

const cloneTask = <TTask extends Task>(task: TTask): TTask => {
  return {
    ...task,
    payload: { ...task.payload },
    result: task.result ? { ...task.result } : null,
  } as TTask;
};

export const createTask = <TType extends TaskType>(
  type: TType,
  payload: TaskPayloadMap[TType],
) => {
  const state = getState();
  const task: Task = {
    id: crypto.randomUUID(),
    type,
    status: "queued",
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    error: null,
    payload,
    result: null,
  } as Task;

  state.tasks.set(task.id, task);
  getQueueForType(state, type).push(task.id);

  return cloneTask(task);
};

export const getTask = (taskId: string) => {
  const task = getState().tasks.get(taskId);
  return task ? cloneTask(task) : null;
};

export const listQueuedTasks = (type: TaskType) => {
  const state = getState();
  return cloneQueue(state, getQueueForType(state, type));
};

export const listAllTasks = () => {
  const state = getState();
  return [...state.tasks.values()].map((task) => cloneTask(task));
};

export const updateTaskStatus = (
  taskId: string,
  input: {
    status?: TaskStatus;
    error?: string | null;
    result?: TaskResultMap[TaskType] | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  },
) => {
  const state = getState();
  const task = state.tasks.get(taskId);
  if (!task) return null;

  const nextTask: Task = {
    ...task,
    status: input.status ?? task.status,
    error: input.error !== undefined ? input.error : task.error,
    result: input.result !== undefined ? (input.result as Task["result"]) : task.result,
    startedAt:
      input.startedAt !== undefined ? input.startedAt : task.startedAt,
    finishedAt:
      input.finishedAt !== undefined ? input.finishedAt : task.finishedAt,
  };

  state.tasks.set(taskId, nextTask);
  return cloneTask(nextTask);
};

export const dequeueTask = (taskId: string) => {
  const state = getState();
  state.chatQueue = state.chatQueue.filter((queuedTaskId) => queuedTaskId !== taskId);
  state.comfyQueue = state.comfyQueue.filter((queuedTaskId) => queuedTaskId !== taskId);
};

export const setActiveTaskId = (taskId: string | null) => {
  const state = getState();
  state.activeTaskId = taskId;
};

export const setGpuMode = (gpuMode: GpuMode) => {
  const state = getState();
  state.gpuMode = gpuMode;
};

export const setSchedulerLastError = (error: string | null) => {
  const state = getState();
  state.lastError = error;
};

export const getSchedulerLastError = () => {
  return getState().lastError;
};

export const attachComfyJobToTask = (jobId: string, taskId: string) => {
  const state = getState();
  state.comfyJobToTaskId.set(jobId, taskId);
};

export const getTaskIdForComfyJob = (jobId: string) => {
  return getState().comfyJobToTaskId.get(jobId) ?? null;
};

export const detachComfyJob = (jobId: string) => {
  getState().comfyJobToTaskId.delete(jobId);
};

export const getSchedulerSnapshot = (): SchedulerSnapshot => {
  const state = getState();
  const queues: TaskQueueSnapshot = {
    chat: cloneQueue(state, state.chatQueue),
    comfy: cloneQueue(state, state.comfyQueue),
  };

  return {
    gpuMode: state.gpuMode,
    activeTaskId: state.activeTaskId,
    queues,
  };
};

export const resetTaskStore = () => {
  const state = getState();
  state.tasks.clear();
  state.chatQueue = [];
  state.comfyQueue = [];
  state.activeTaskId = null;
  state.gpuMode = "chat";
  state.comfyJobToTaskId.clear();
  state.lastError = null;
};
