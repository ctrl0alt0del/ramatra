import {
  type SchedulerSnapshot,
  type TaskGroup,
  type TaskEventMap,
} from "@/lib/tasks/types";

type TaskEventName = keyof TaskEventMap;
type TaskEventListener<TEventName extends TaskEventName> = (
  payload: TaskEventMap[TEventName],
) => void;

type ListenerMap = {
  [TEventName in TaskEventName]: Set<TaskEventListener<TEventName>>;
};

declare global {
  var __comfyBridgeTaskEventBus:
    | {
        listeners: ListenerMap;
      }
    | undefined;
}

const createListeners = (): ListenerMap => ({
  "task:queued": new Set(),
  "task:started": new Set(),
  "task:updated": new Set(),
  "task:completed": new Set(),
  "task:failed": new Set(),
  "task:cancelled": new Set(),
  "queue:changed": new Set(),
  "gpu:changed": new Set(),
});

const getBus = () => {
  if (!globalThis.__comfyBridgeTaskEventBus) {
    globalThis.__comfyBridgeTaskEventBus = {
      listeners: createListeners(),
    };
  }

  return globalThis.__comfyBridgeTaskEventBus;
};

export const subscribeToTaskEvent = <TEventName extends TaskEventName>(
  eventName: TEventName,
  listener: TaskEventListener<TEventName>,
) => {
  const bus = getBus();
  const listeners = bus.listeners[eventName] as Set<TaskEventListener<TEventName>>;
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

export const publishTaskEvent = <TEventName extends TaskEventName>(
  eventName: TEventName,
  payload: TaskEventMap[TEventName],
) => {
  const bus = getBus();
  const listeners = bus.listeners[eventName] as Set<TaskEventListener<TEventName>>;

  for (const listener of listeners) {
    listener(payload);
  }
};

export const emitQueuedTask = (task: TaskGroup) => {
  publishTaskEvent("task:queued", { task });
};

export const emitStartedTask = (task: TaskGroup) => {
  publishTaskEvent("task:started", { task });
};

export const emitUpdatedTask = (task: TaskGroup) => {
  publishTaskEvent("task:updated", { task });
};

export const emitCompletedTask = (task: TaskGroup) => {
  publishTaskEvent("task:completed", { task });
};

export const emitFailedTask = (task: TaskGroup) => {
  publishTaskEvent("task:failed", { task });
};

export const emitCancelledTask = (task: TaskGroup) => {
  publishTaskEvent("task:cancelled", { task });
};

export const emitQueueChanged = (snapshot: SchedulerSnapshot) => {
  publishTaskEvent("queue:changed", snapshot);
};

export const emitGpuChanged = (snapshot: SchedulerSnapshot) => {
  publishTaskEvent("gpu:changed", snapshot);
};
