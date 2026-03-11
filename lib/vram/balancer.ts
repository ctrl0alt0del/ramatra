import { getClient } from "@/lib/comfy/client";
import {
  getLoadedChatInstanceId,
  loadLmStudioModel,
  unloadLmStudioModel,
} from "@/lib/lmstudio/models";

export type VramBalancerPhase =
  | "chat_ready"
  | "switching_to_image"
  | "image_running"
  | "restoring_chat";

export type VramBalancerState = {
  phase: VramBalancerPhase;
  canChat: boolean;
  activeGenerationCount: number;
  message: string;
  lastError: string | null;
};

type VramBalancerStore = {
  activeJobIds: Set<string>;
  state: VramBalancerState;
  transitionPromise: Promise<void> | null;
};

declare global {
  var __comfyBridgeVramBalancer: VramBalancerStore | undefined;
}

const getStore = () => {
  if (!globalThis.__comfyBridgeVramBalancer) {
    globalThis.__comfyBridgeVramBalancer = {
      activeJobIds: new Set<string>(),
      state: {
        phase: "chat_ready",
        canChat: true,
        activeGenerationCount: 0,
        message: "Chat model ready.",
        lastError: null,
      },
      transitionPromise: null,
    };
  }

  return globalThis.__comfyBridgeVramBalancer;
};

const updateState = (partial: Partial<VramBalancerState>) => {
  const store = getStore();
  store.state = {
    ...store.state,
    ...partial,
    activeGenerationCount: store.activeJobIds.size,
  };
};

const getChatModelKey = () => {
  const modelKey = process.env.LM_STUDIO_MODEL;
  if (!modelKey) {
    throw new Error("LM_STUDIO_MODEL is not configured.");
  }
  return modelKey;
};

const unloadChatModelForImageMode = async () => {
  const instanceId = await getLoadedChatInstanceId(getChatModelKey());
  if (!instanceId) {
    return;
  }

  await unloadLmStudioModel(instanceId);
};

const restoreChatMode = async () => {
  const client = await getClient();
  await client.free({
    unload_models: true,
    free_memory: true,
  });

  await loadLmStudioModel(getChatModelKey());
};

const runTransition = async (task: () => Promise<void>) => {
  const store = getStore();
  const previous = store.transitionPromise ?? Promise.resolve();
  const next = previous.then(task, task);
  store.transitionPromise = next;

  try {
    await next;
  } finally {
    if (store.transitionPromise === next) {
      store.transitionPromise = null;
    }
  }
};

export const getVramBalancerState = (): VramBalancerState => {
  const store = getStore();
  return {
    ...store.state,
    activeGenerationCount: store.activeJobIds.size,
  };
};

export const assertChatAvailable = () => {
  const state = getVramBalancerState();
  if (state.canChat) return;

  throw new Error(state.message);
};

export const registerImageGenerationStart = async (jobId: string) => {
  const store = getStore();
  if (store.activeJobIds.has(jobId)) {
    return;
  }

  store.activeJobIds.add(jobId);
  updateState({
    phase: "switching_to_image",
    canChat: false,
    message: "Preparing GPU memory for image generation.",
    lastError: null,
  });

  if (store.activeJobIds.size > 1) {
    updateState({
      phase: "image_running",
      canChat: false,
      message: "Image generation is using the GPU. Chat is temporarily paused.",
    });
    return;
  }

  try {
    await runTransition(async () => {
      await unloadChatModelForImageMode();
      updateState({
        phase: "image_running",
        canChat: false,
        message: "Image generation is using the GPU. Chat is temporarily paused.",
        lastError: null,
      });
    });
  } catch (error) {
    updateState({
      phase: "image_running",
      canChat: false,
      message: "Image generation is using the GPU. Chat is temporarily paused.",
      lastError: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const registerImageGenerationFinish = async (jobId: string) => {
  const store = getStore();
  if (!store.activeJobIds.delete(jobId)) {
    return;
  }

  if (store.activeJobIds.size > 0) {
    updateState({
      phase: "image_running",
      canChat: false,
      message: "Image generation is using the GPU. Chat is temporarily paused.",
    });
    return;
  }

  updateState({
    phase: "restoring_chat",
    canChat: false,
    message: "Restoring the chat model after image generation.",
    lastError: null,
  });

  try {
    await runTransition(async () => {
      await restoreChatMode();
      updateState({
        phase: "chat_ready",
        canChat: true,
        message: "Chat model ready.",
        lastError: null,
      });
    });
  } catch (error) {
    updateState({
      phase: "restoring_chat",
      canChat: false,
      message: "Chat model failed to reload. Restore it before chatting again.",
      lastError: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
