import { getClient } from "@/lib/comfy/client";
import {
  getLoadedChatInstanceId,
  loadLmStudioModel,
  unloadAllLmStudioModels,
} from "@/lib/lmstudio/models";
import { getActiveTask, getSchedulerState, setSchedulerGpuMode } from "@/lib/tasks/scheduler";
import {
  getSchedulerLastError,
  resetTaskStore,
  setSchedulerLastError,
} from "@/lib/tasks/store";

declare global {
  var __comfyBridgeGpuTransitionPromise: Promise<void> | null | undefined;
}

const getChatModelKey = () => {
  const modelKey = process.env.LM_STUDIO_MODEL;
  if (!modelKey) {
    throw new Error("LM_STUDIO_MODEL is not configured.");
  }
  return modelKey;
};

const runTransition = async (task: () => Promise<void>) => {
  const previous = globalThis.__comfyBridgeGpuTransitionPromise ?? Promise.resolve();
  const next = previous.then(task, task);
  globalThis.__comfyBridgeGpuTransitionPromise = next;

  try {
    await next;
  } finally {
    if (globalThis.__comfyBridgeGpuTransitionPromise === next) {
      globalThis.__comfyBridgeGpuTransitionPromise = null;
    }
  }
};

const ensureChatModelLoaded = async () => {
  const modelKey = getChatModelKey();
  const loadedInstanceId = await getLoadedChatInstanceId(modelKey);

  if (loadedInstanceId) {
    return loadedInstanceId;
  }

  await loadLmStudioModel(modelKey);
  return getLoadedChatInstanceId(modelKey);
};

export const switchToComfyGpuMode = async () => {
  try {
    await runTransition(async () => {
      setSchedulerGpuMode("switching");
      setSchedulerLastError(null);

      await unloadAllLmStudioModels();

      setSchedulerGpuMode("comfy");
    });
  } catch (error) {
    setSchedulerLastError(
      error instanceof Error ? error.message : "Failed to switch to Comfy GPU mode.",
    );
    setSchedulerGpuMode("chat");
    throw error;
  }
};

export const switchToChatGpuMode = async () => {
  try {
    await runTransition(async () => {
      setSchedulerGpuMode("switching");
      setSchedulerLastError(null);

      const client = await getClient();
      await client.free({
        unload_models: true,
        free_memory: true,
      });

      await ensureChatModelLoaded();
      setSchedulerGpuMode("chat");
    });
  } catch (error) {
    setSchedulerLastError(
      error instanceof Error ? error.message : "Failed to restore chat GPU mode.",
    );
    throw error;
  }
};

export const forceResumeChatGpuMode = async () => {
  try {
    await runTransition(async () => {
      setSchedulerGpuMode("switching");
      setSchedulerLastError(null);

      const client = await getClient();

      try {
        await client.interrupt();
      } catch {
        // Ignore if nothing is running.
      }

      try {
        await client.clearItems("queue");
      } catch {
        // Ignore queue clear failures and continue recovery.
      }

      await client.free({
        unload_models: true,
        free_memory: true,
      });

      resetTaskStore();
      await ensureChatModelLoaded();
      setSchedulerGpuMode("chat");
    });
  } catch (error) {
    setSchedulerLastError(
      error instanceof Error ? error.message : "Failed to force resume chat mode.",
    );
    throw error;
  }
};

export const getSchedulerSystemState = () => {
  const snapshot = getSchedulerState();
  const activeTask = getActiveTask();
  const activeComfyCount =
    snapshot.queues.comfy.filter((task) => task.status === "queued").length +
    (activeTask?.type === "comfy" ? 1 : 0);
  const lastError = getSchedulerLastError();

  if (snapshot.gpuMode === "switching") {
    return {
      phase: activeTask?.type === "comfy" ? "switching_to_image" : "restoring_chat",
      canChat: false,
      activeGenerationCount: activeComfyCount,
      message:
        activeTask?.type === "comfy"
          ? "Preparing GPU memory for image generation."
          : "Restoring the chat model.",
      lastError,
    };
  }

  if (snapshot.gpuMode === "comfy" || activeTask?.type === "comfy") {
    return {
      phase: "image_running" as const,
      canChat: false,
      activeGenerationCount: activeComfyCount,
      message: "Image generation is using the GPU. Chat is temporarily paused.",
      lastError,
    };
  }

  return {
    phase: "chat_ready" as const,
    canChat: true,
    activeGenerationCount: activeComfyCount,
    message: "Chat model ready.",
    lastError,
  };
};
