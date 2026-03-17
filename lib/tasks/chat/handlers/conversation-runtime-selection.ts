import type { LmStudioInputItem } from "@/lib/tasks/chat/lm-input";
import { prepareConversationGenerateRequest } from "@/lib/tasks/chat/handlers/conversation-prepare";
import type {
  ChatTask,
  ConversationRuntimeDeps,
  PendingChatStreamState,
  RuntimeThreadSnapshot,
} from "@/lib/tasks/chat/handlers/conversation-runtime.types";

export const resolveConversationRuntimeSelection = async ({
  task,
  taskKind,
  thread,
  requestedContextLength,
  getChatModelKey,
  ensureLmStudioModelLoaded,
  resolvePreferredLmStudioModelTarget,
  listLoadedLmStudioModels,
  isTransientLmStudioFetchError,
  formatLoadedLmStudioModelsForDebug,
  logChatModelDebug,
  getPendingChatStreams,
}: {
  task: ChatTask;
  taskKind: "chat.generate" | "chat.stream";
  thread: RuntimeThreadSnapshot;
  requestedContextLength: number;
  getChatModelKey: ConversationRuntimeDeps["getChatModelKey"];
  ensureLmStudioModelLoaded: ConversationRuntimeDeps["ensureLmStudioModelLoaded"];
  resolvePreferredLmStudioModelTarget: ConversationRuntimeDeps["resolvePreferredLmStudioModelTarget"];
  listLoadedLmStudioModels: ConversationRuntimeDeps["listLoadedLmStudioModels"];
  isTransientLmStudioFetchError: ConversationRuntimeDeps["isTransientLmStudioFetchError"];
  formatLoadedLmStudioModelsForDebug: ConversationRuntimeDeps["formatLoadedLmStudioModelsForDebug"];
  logChatModelDebug: ConversationRuntimeDeps["logChatModelDebug"];
  getPendingChatStreams: () => Map<string, PendingChatStreamState>;
}): Promise<{
  modelTarget: string;
  userInput: string | LmStudioInputItem[] | null;
  effectivePreviousResponseId: string | null;
  summaryCallsInCurrentRequest: number | null;
}> => {
  if (taskKind === "chat.generate") {
    const preparedGenerate = await prepareConversationGenerateRequest({
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
    });
    return {
      modelTarget: preparedGenerate.modelTarget,
      userInput: preparedGenerate.userInput,
      effectivePreviousResponseId: preparedGenerate.effectivePreviousResponseId,
      summaryCallsInCurrentRequest: null,
    };
  }

  const pending = getPendingChatStreams().get(task.id);
  if (!pending) {
    throw new Error("chat.stream task has no pending stream.");
  }

  return {
    modelTarget: pending.modelTarget,
    userInput: null,
    effectivePreviousResponseId: null,
    summaryCallsInCurrentRequest: pending.summaryCallsInCurrentRequest,
  };
};
