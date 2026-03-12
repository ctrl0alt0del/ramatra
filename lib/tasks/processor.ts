import { getActiveTask, getNextSchedulableTask } from "@/lib/tasks/scheduler";

declare global {
  var __comfyBridgeTaskProcessorPromise: Promise<void> | null | undefined;
}

export const processTaskQueues = async () => {
  if (globalThis.__comfyBridgeTaskProcessorPromise) {
    return globalThis.__comfyBridgeTaskProcessorPromise;
  }

  globalThis.__comfyBridgeTaskProcessorPromise = (async () => {
    while (!getActiveTask()) {
      const nextTask = getNextSchedulableTask();
      if (!nextTask) {
        break;
      }

      if (nextTask.type === "chat") {
        const { executeQueuedChatTask } = await import("@/lib/tasks/chat-runner");
        await executeQueuedChatTask(nextTask.id);
        continue;
      }

      const { executeQueuedComfyTask } = await import("@/lib/tasks/comfy-runner");
      await executeQueuedComfyTask(nextTask.id);
    }
  })();

  try {
    await globalThis.__comfyBridgeTaskProcessorPromise;
  } finally {
    globalThis.__comfyBridgeTaskProcessorPromise = null;
  }
};
