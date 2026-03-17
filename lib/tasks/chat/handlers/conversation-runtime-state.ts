import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import type { LmStudioInputItem } from "@/lib/tasks/chat/lm-input";
import { executeConversationPreflightCompaction } from "@/lib/tasks/chat/handlers/conversation-preflight";
import { createConversationRuntimeSummaryState } from "@/lib/tasks/chat/handlers/conversation-runtime-summary";
import { resolveConversationRuntimeSelection } from "@/lib/tasks/chat/handlers/conversation-runtime-selection";
import type {
  ChatTask,
  ConversationRuntimeDeps,
  RuntimeThreadSnapshot,
} from "@/lib/tasks/chat/handlers/conversation-runtime.types";

export const initializeConversationRuntimeState = async ({
  task,
  taskKind,
  thread,
  promptMode,
  moodId,
  requestedContextLength,
  isPersistentConversation,
  compactThresholdRatio,
  getChatModelKey,
  ensureLmStudioModelLoaded,
  resolvePreferredLmStudioModelTarget,
  listLoadedLmStudioModels,
  isTransientLmStudioFetchError,
  formatLoadedLmStudioModelsForDebug,
  logChatModelDebug,
  updateThread,
  getPendingChatStreams,
}: {
  task: ChatTask;
  taskKind: "chat.generate" | "chat.stream";
  thread: RuntimeThreadSnapshot;
  promptMode: PromptMode;
  moodId: string | null;
  requestedContextLength: number;
  isPersistentConversation: boolean;
  compactThresholdRatio: number;
  getChatModelKey: ConversationRuntimeDeps["getChatModelKey"];
  ensureLmStudioModelLoaded: ConversationRuntimeDeps["ensureLmStudioModelLoaded"];
  resolvePreferredLmStudioModelTarget: ConversationRuntimeDeps["resolvePreferredLmStudioModelTarget"];
  listLoadedLmStudioModels: ConversationRuntimeDeps["listLoadedLmStudioModels"];
  isTransientLmStudioFetchError: ConversationRuntimeDeps["isTransientLmStudioFetchError"];
  formatLoadedLmStudioModelsForDebug: ConversationRuntimeDeps["formatLoadedLmStudioModelsForDebug"];
  logChatModelDebug: ConversationRuntimeDeps["logChatModelDebug"];
  updateThread: (
    threadId: string,
    patch:
      | { summaryCallsInCurrentRequest: number }
      | { contextWindowUsedTokens?: number | null; contextWindowTotalTokens?: number },
  ) => unknown;
  getPendingChatStreams: ConversationRuntimeDeps["getPendingChatStreams"];
}) => {
  const summaryState = createConversationRuntimeSummaryState({
    task,
    thread,
    isPersistentConversation,
    updateThread,
  });

  const preflight = executeConversationPreflightCompaction({
    task,
    taskKind,
    thread: summaryState.getThread(),
    promptMode,
    moodId,
    requestedContextLength,
    isPersistentConversation,
    summaryCallsInCurrentRequest: summaryState.getSummaryCallsInCurrentRequest(),
    compactThresholdRatio,
    setSummaryCallsInCurrentRequest: summaryState.setSummaryCallsInCurrentRequest,
    updateThread: summaryState.updateThreadAndSync,
  });
  if (preflight.delegated) {
    return { delegated: true as const };
  }

  const selection = await resolveConversationRuntimeSelection({
    task,
    taskKind,
    thread: summaryState.getThread(),
    requestedContextLength,
    getChatModelKey,
    ensureLmStudioModelLoaded,
    resolvePreferredLmStudioModelTarget,
    listLoadedLmStudioModels,
    isTransientLmStudioFetchError,
    formatLoadedLmStudioModelsForDebug,
    logChatModelDebug,
    getPendingChatStreams,
  });

  if (selection.summaryCallsInCurrentRequest !== null) {
    summaryState.setSummaryCallsInCurrentRequest(
      selection.summaryCallsInCurrentRequest,
    );
  }

  return {
    delegated: false as const,
    mutableThread: summaryState.getThread(),
    summaryCallsInCurrentRequest: summaryState.getSummaryCallsInCurrentRequest(),
    modelTarget: selection.modelTarget,
    userInput: selection.userInput as string | LmStudioInputItem[] | null,
    effectivePreviousResponseId: selection.effectivePreviousResponseId,
  };
};
