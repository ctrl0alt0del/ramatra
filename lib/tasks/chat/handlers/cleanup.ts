import {
  cleanupRedundantLmStudioModels,
  formatLoadedLmStudioModelsForDebug,
  isTransientLmStudioFetchError,
  listLoadedLmStudioModels,
  type LoadedLmStudioModelInstance,
} from "@/lib/lmstudio/models";

export const cleanupChatTaskLmStudioState = async ({
  taskId,
  getChatModelKey,
  logChatModelDebug,
}: {
  taskId: string;
  getChatModelKey: () => string;
  logChatModelDebug: (phase: string, payload: Record<string, unknown>) => void;
}) => {
  try {
    const unloaded = await cleanupRedundantLmStudioModels({
      activeModelKey: getChatModelKey(),
    });
    let loadedAfterCleanup: LoadedLmStudioModelInstance[] = [];
    try {
      loadedAfterCleanup = await listLoadedLmStudioModels();
    } catch (error) {
      if (isTransientLmStudioFetchError(error)) {
        console.warn(
          "[chat-runner] LM Studio model list unavailable after cleanup; continuing",
          {
            taskId,
            reason: error instanceof Error ? error.message : String(error),
          },
        );
      } else {
        throw error;
      }
    }

    logChatModelDebug("cleanup:after", {
      taskId,
      loadedModels: formatLoadedLmStudioModelsForDebug(loadedAfterCleanup),
      unloaded: formatLoadedLmStudioModelsForDebug(unloaded),
    });
  } catch (error) {
    console.error(
      "[chat-runner] failed to cleanup redundant LM Studio models",
      error,
    );
  }
};
