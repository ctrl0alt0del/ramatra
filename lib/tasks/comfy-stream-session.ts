type PendingComfyStreamSession = {
  taskGroupId: string;
  jobId: string;
  createdAt: string;
};

declare global {
  var __comfyBridgePendingComfyStreamSessions:
    | Map<string, PendingComfyStreamSession>
    | undefined;
}

const getStore = () => {
  if (!globalThis.__comfyBridgePendingComfyStreamSessions) {
    globalThis.__comfyBridgePendingComfyStreamSessions = new Map();
  }
  return globalThis.__comfyBridgePendingComfyStreamSessions;
};

export const setPendingComfyStreamSession = (input: {
  taskGroupId: string;
  jobId: string;
}) => {
  const store = getStore();
  const session: PendingComfyStreamSession = {
    taskGroupId: input.taskGroupId,
    jobId: input.jobId,
    createdAt: new Date().toISOString(),
  };
  store.set(input.taskGroupId, session);
  return session;
};

export const getPendingComfyStreamSession = (taskGroupId: string) => {
  return getStore().get(taskGroupId) ?? null;
};

export const clearPendingComfyStreamSession = (taskGroupId: string) => {
  return getStore().delete(taskGroupId);
};
