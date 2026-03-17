import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import { initializeConversationRuntimeState } from "@/lib/tasks/chat/handlers/conversation-runtime-state";
import { executeConversationStreamingLifecycle } from "@/lib/tasks/chat/handlers/conversation-runtime-streaming";
import { executeConversationRuntimeOverflowStage } from "@/lib/tasks/chat/handlers/conversation-runtime-overflow-stage";
import type {
  ChatTask,
  ConversationRuntimeDeps,
  RuntimeThreadSnapshot,
} from "@/lib/tasks/chat/handlers/conversation-runtime.types";

export const executeConversationRuntime = async ({
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
  requestLmStudioChat,
  formatUnknownError,
  buildUtilHistorySnapshot,
  persistConversationStreamResult,
  maybeEnqueueTitleGenerationTask,
  finalizeConversationViaStreamTask,
  setGroupTaskStatusByKind,
  updateRunningTask,
  updateChatTaskPayload,
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
} & ConversationRuntimeDeps) => {
  const initialized = await initializeConversationRuntimeState({
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
  });
  if (initialized.delegated) {
    return true;
  }

  const streaming = await executeConversationStreamingLifecycle({
    task,
    taskKind,
    modelTarget: initialized.modelTarget,
    userInput: initialized.userInput,
    effectivePreviousResponseId: initialized.effectivePreviousResponseId,
    summaryCallsInCurrentRequest: initialized.summaryCallsInCurrentRequest,
    promptMode,
    moodId,
    requestedContextLength,
    requestLmStudioChat,
    formatUnknownError,
    setGroupTaskStatusByKind,
    updateRunningTask,
    getPendingChatStreams,
  });
  if (streaming.delegated) {
    return true;
  }

  return executeConversationRuntimeOverflowStage({
    task,
    mutableThread: initialized.mutableThread,
    promptMode,
    moodId,
    requestedContextLength,
    compactThresholdRatio,
    summaryCallsInCurrentRequest: initialized.summaryCallsInCurrentRequest,
    streaming,
    persistConversationStreamResult,
    maybeEnqueueTitleGenerationTask,
    finalizeConversationViaStreamTask,
    setGroupTaskStatusByKind,
    updateRunningTask,
    updateChatTaskPayload,
    updateThread,
    buildUtilHistorySnapshot,
  });
};
