import type { LoadedLmStudioModelInstance } from "@/lib/lmstudio/models";

export const resolveConversationModelTarget = async ({
  requestedContextLength,
  getChatModelKey,
  threadModelInstanceId,
  ensureLmStudioModelLoaded,
  resolvePreferredLmStudioModelTarget,
}: {
  requestedContextLength: number;
  getChatModelKey: () => string;
  threadModelInstanceId: string | null;
  ensureLmStudioModelLoaded: (args: {
    modelKey: string;
    contextLength: number;
  }) => Promise<{ instanceId: string }>;
  resolvePreferredLmStudioModelTarget: (args: {
    preferredInstanceId: string;
    modelKey: string;
  }) => Promise<string>;
}) => {
  const modelKey = getChatModelKey();
  const exactLoadedModel = await ensureLmStudioModelLoaded({
    modelKey,
    contextLength: requestedContextLength,
  });

  const preferredInstanceId =
    threadModelInstanceId === exactLoadedModel.instanceId
      ? threadModelInstanceId
      : exactLoadedModel.instanceId;

  const modelTarget = await resolvePreferredLmStudioModelTarget({
    preferredInstanceId,
    modelKey,
  });

  return {
    modelKey,
    modelTarget,
  };
};

export const readLoadedModelsBestEffort = async ({
  taskId,
  listLoadedLmStudioModels,
  isTransientLmStudioFetchError,
}: {
  taskId: string;
  listLoadedLmStudioModels: () => Promise<LoadedLmStudioModelInstance[]>;
  isTransientLmStudioFetchError: (error: unknown) => boolean;
}) => {
  let loadedBeforeRequest: LoadedLmStudioModelInstance[] = [];
  try {
    loadedBeforeRequest = await listLoadedLmStudioModels();
  } catch (error) {
    if (isTransientLmStudioFetchError(error)) {
      console.warn(
        "[chat-runner] LM Studio model list unavailable before request; continuing",
        {
          taskId,
          reason: error instanceof Error ? error.message : String(error),
        },
      );
    } else {
      throw error;
    }
  }

  return loadedBeforeRequest;
};
