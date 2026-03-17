import {
  ensureLmStudioModelLoaded,
  formatLoadedLmStudioModelsForDebug,
  isTransientLmStudioFetchError,
  listLoadedLmStudioModels,
  resolvePreferredLmStudioModelTarget,
} from "@/lib/lmstudio/models";
import { requestLmStudioChat } from "@/lib/tasks/chat/adapters/lm-studio-client";
import { persistConversationStreamResult } from "@/lib/tasks/chat/handlers/conversation";
import { maybeEnqueueTitleGenerationTask } from "@/lib/tasks/chat/handlers/title";
import { finalizeConversationViaStreamTask } from "@/lib/tasks/chat/handlers/stream-finalize";
import { buildIntegrations } from "@/lib/tasks/chat/integrations";
import { formatUnknownError, logChatModelDebug } from "@/lib/tasks/chat/logging";
import { buildUtilHistorySnapshot } from "@/lib/tasks/chat/util-history";
import type { ConversationRuntimeDeps } from "@/lib/tasks/chat/handlers/conversation-runtime.types";
import type { Task, TaskGroupPayloadMap, TaskGroupResultMap } from "@/lib/tasks/types";

export const createConversationRuntimeDeps = ({
  getChatModelKey,
  setGroupTaskStatusByKind,
  updateRunningTask,
  updateChatTaskPayload,
  updateThread,
  getPendingChatStreams,
}: {
  getChatModelKey: () => string;
  setGroupTaskStatusByKind: (args: {
    taskId: string;
    kind: Task["kind"];
    status: "pending" | "completed";
  }) => void;
  updateRunningTask: (
    taskId: string,
    patch: { result: TaskGroupResultMap["chat"] },
  ) => void;
  updateChatTaskPayload: (
    taskId: string,
    payload: TaskGroupPayloadMap["chat"],
  ) => unknown;
  updateThread: (
    threadId: string,
    patch: Record<string, unknown>,
  ) => unknown;
  getPendingChatStreams: ConversationRuntimeDeps["getPendingChatStreams"];
}): ConversationRuntimeDeps => ({
  getChatModelKey,
  ensureLmStudioModelLoaded,
  resolvePreferredLmStudioModelTarget,
  listLoadedLmStudioModels,
  isTransientLmStudioFetchError,
  formatLoadedLmStudioModelsForDebug,
  logChatModelDebug,
  requestLmStudioChat,
  formatUnknownError,
  buildIntegrations,
  buildUtilHistorySnapshot,
  persistConversationStreamResult,
  maybeEnqueueTitleGenerationTask,
  finalizeConversationViaStreamTask: ({
    taskId,
    text,
    reasoning,
    responseId,
    summaryCallsInCurrentRequest,
  }) =>
    finalizeConversationViaStreamTask({
      taskId,
      text,
      reasoning,
      responseId,
      summaryCallsInCurrentRequest,
      updateRunningTask,
      setGroupTaskStatusByKind,
    }),
  setGroupTaskStatusByKind,
  updateRunningTask,
  updateChatTaskPayload,
  updateThread: updateThread as ConversationRuntimeDeps["updateThread"],
  getPendingChatStreams,
});
