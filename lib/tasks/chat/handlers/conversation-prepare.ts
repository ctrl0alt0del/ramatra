import type { LoadedLmStudioModelInstance } from "@/lib/lmstudio/models";
import type { LmStudioInputItem } from "@/lib/tasks/chat/lm-input";
import {
  readLoadedModelsBestEffort,
  resolveConversationModelTarget,
} from "@/lib/tasks/chat/handlers/conversation-prepare-model";
import { prepareConversationInput } from "@/lib/tasks/chat/handlers/conversation-prepare-input";
import type { TaskGroup } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export const prepareConversationGenerateRequest = async ({
  task,
  thread,
  requestedContextLength,
  getChatModelKey,
  ensureLmStudioModelLoaded,
  resolvePreferredLmStudioModelTarget,
  listLoadedLmStudioModels,
  isTransientLmStudioFetchError,
  formatLoadedLmStudioModelsForDebug,
  logChatModelDebug,
}: {
  task: ChatTask;
  thread:
    | {
        id: string;
        messages: Array<{
          role: "user" | "assistant" | "system";
          content: import("@/lib/chat/message-content").MessagePart[];
        }>;
        lmstudioResponseId: string | null;
        lmstudioModelInstanceId: string | null;
        conversationSummary: string | null;
      }
    | null;
  requestedContextLength: number;
  getChatModelKey: () => string;
  ensureLmStudioModelLoaded: (args: {
    modelKey: string;
    contextLength: number;
  }) => Promise<{ instanceId: string }>;
  resolvePreferredLmStudioModelTarget: (args: {
    preferredInstanceId: string;
    modelKey: string;
  }) => Promise<string>;
  listLoadedLmStudioModels: () => Promise<LoadedLmStudioModelInstance[]>;
  isTransientLmStudioFetchError: (error: unknown) => boolean;
  formatLoadedLmStudioModelsForDebug: (
    models: LoadedLmStudioModelInstance[],
  ) => unknown;
  logChatModelDebug: (phase: string, payload: Record<string, unknown>) => void;
}): Promise<{
  modelTarget: string;
  userInput: string | LmStudioInputItem[];
  effectivePreviousResponseId: string | null;
}> => {
  if (task.payload.kind !== "conversation") {
    throw new Error("chat.generate task requires conversation payload.");
  }
  const conversationPayload = task.payload;

  const { userInput, effectivePreviousResponseId, generatedImageLimit } =
    prepareConversationInput({
      payload: conversationPayload,
      thread,
      requestedContextLength,
    });

  const { modelKey, modelTarget } = await resolveConversationModelTarget({
    requestedContextLength,
    getChatModelKey,
    threadModelInstanceId: thread?.lmstudioModelInstanceId ?? null,
    ensureLmStudioModelLoaded,
    resolvePreferredLmStudioModelTarget,
  });
  const loadedBeforeRequest: LoadedLmStudioModelInstance[] =
    await readLoadedModelsBestEffort({
      taskId: task.id,
      listLoadedLmStudioModels,
      isTransientLmStudioFetchError,
    });

  logChatModelDebug("request:start", {
    taskId: task.id,
    kind: conversationPayload.kind,
    threadId: thread?.id ?? null,
    configuredModelKey: modelKey,
    preferredInstanceId: thread?.lmstudioModelInstanceId ?? null,
    selectedModelTarget: modelTarget,
    requestedContextLength,
    generatedImageLimit,
    previousResponseId: effectivePreviousResponseId,
    loadedModels: formatLoadedLmStudioModelsForDebug(loadedBeforeRequest),
  });

  return {
    modelTarget,
    userInput,
    effectivePreviousResponseId,
  };
};
