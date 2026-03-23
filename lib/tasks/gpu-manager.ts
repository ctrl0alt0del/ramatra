import { getClient } from "@/lib/comfy/client";
import {
  ensureLmStudioModelLoaded,
  formatLoadedLmStudioModelsForDebug,
  getLoadedChatInstanceId,
  listLoadedLmStudioModels,
  unloadAllLmStudioModels,
} from "@/lib/lmstudio/models";
import { getConfiguredContextLengthForMode } from "@/lib/lmstudio/context-length";
import { defaultPromptMode, isPromptMode } from "@/lib/lmstudio/prompt-modes";
import { getActiveTask, getSchedulerState, setSchedulerGpuMode } from "@/lib/tasks/scheduler";
import {
  getSchedulerLastError,
  resetTaskStore,
  setSchedulerLastError,
} from "@/lib/tasks/store";
import type { TaskGroup } from "@/lib/tasks/types";

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

const isLmStudioModelDebugEnabled = () =>
  process.env.LM_STUDIO_DEBUG_MODEL_ROUTING === "true";

const logGpuModelDebug = (phase: string, payload: Record<string, unknown>) => {
  if (!isLmStudioModelDebugEnabled()) {
    return;
  }

  console.info(`[gpu-manager] ${phase}`, payload);
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
  const before = await listLoadedLmStudioModels();
  const loadedInstanceId = await getLoadedChatInstanceId(modelKey);

  logGpuModelDebug("ensure-chat-model-loaded:check", {
    modelKey,
    loadedInstanceId,
    loadedModels: formatLoadedLmStudioModelsForDebug(before),
  });

  if (loadedInstanceId) {
    return loadedInstanceId;
  }

  const loadedModel = await ensureLmStudioModelLoaded({
    modelKey,
    contextLength: getConfiguredContextLengthForMode(
      defaultPromptMode,
      process.env,
    ),
  });
  const after = await listLoadedLmStudioModels();
  const nextLoadedInstanceId = loadedModel.instanceId;

  logGpuModelDebug("ensure-chat-model-loaded:loaded", {
    modelKey,
    loadedInstanceId: nextLoadedInstanceId,
    loadedModels: formatLoadedLmStudioModelsForDebug(after),
  });

  return nextLoadedInstanceId;
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

const resolveChatTaskContextLength = (task: Extract<TaskGroup, { type: "chat" }>) => {
  if (
    typeof task.payload.contextLength === "number" &&
    Number.isFinite(task.payload.contextLength) &&
    task.payload.contextLength > 0
  ) {
    return Math.floor(task.payload.contextLength);
  }

  if ("promptMode" in task.payload && isPromptMode(task.payload.promptMode)) {
    const base = getConfiguredContextLengthForMode(task.payload.promptMode, process.env);
    return task.payload.kind === "collapse_context" ? base * 2 : base;
  }

  return getConfiguredContextLengthForMode(defaultPromptMode, process.env);
};

export const prepareChatGpuForTaskGroup = async (
  task: Extract<TaskGroup, { type: "chat" }>,
) => {
  const contextLength = resolveChatTaskContextLength(task);
  const modelKey = getChatModelKey();
  await ensureLmStudioModelLoaded({
    modelKey,
    contextLength,
  });
  if (getSchedulerState().gpuMode !== "chat") {
    setSchedulerGpuMode("chat");
  }
  logGpuModelDebug("prepare-chat-task-group", {
    taskGroupId: task.id,
    kind: task.payload.kind,
    contextLength,
    modelKey,
  });
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

      resetTaskStore({ preserveCompletedComfyHistory: true });
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

export const hardResetChatSystem = async () => {
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

      try {
        await client.free({
          unload_models: true,
          free_memory: true,
        });
      } catch {
        // Ignore Comfy free failures and continue reset.
      }

      try {
        await unloadAllLmStudioModels();
      } catch {
        // Ignore LM unload failures and continue reset.
      }

      resetTaskStore();
      setSchedulerGpuMode("chat");
    });
  } catch (error) {
    setSchedulerLastError(
      error instanceof Error ? error.message : "Failed to hard reset chat system.",
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
