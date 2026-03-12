import { type ThreadSummary } from "@/lib/lmstudio/threads";

export type ThreadChangeType = "created" | "updated" | "deleted";

export type ThreadChangedEvent = {
  change: ThreadChangeType;
  threadId: string;
  thread: ThreadSummary | null;
  emittedAt: string;
};

type ThreadEventListener = (payload: ThreadChangedEvent) => void;

declare global {
  var __comfyBridgeThreadEventListeners: Set<ThreadEventListener> | undefined;
}

const getListeners = () => {
  if (!globalThis.__comfyBridgeThreadEventListeners) {
    globalThis.__comfyBridgeThreadEventListeners = new Set<ThreadEventListener>();
  }

  return globalThis.__comfyBridgeThreadEventListeners;
};

export const subscribeToThreadEvents = (listener: ThreadEventListener) => {
  const listeners = getListeners();
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

export const publishThreadChanged = (payload: Omit<ThreadChangedEvent, "emittedAt">) => {
  const listeners = getListeners();
  const event: ThreadChangedEvent = {
    ...payload,
    emittedAt: new Date().toISOString(),
  };

  for (const listener of listeners) {
    listener(event);
  }
};
