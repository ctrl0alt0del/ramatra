import type { Task } from "@/lib/tasks/types";
import { createDispatchHandlers } from "@/lib/tasks/chat/handlers/dispatch-deps";
import type { DispatchContext, DispatchHandler } from "@/lib/tasks/chat/handlers/dispatch.types";

export const dispatchChatTaskHandlers = async ({
  task,
  taskKind,
  thread,
  promptMode,
  moodId,
  requestedContextLength,
  isPersistentConversation,
  compactThresholdRatio,
  getChatModelKey,
  setGroupTaskStatusByKind,
  updateRunningTask,
  updateChatTaskPayload,
  updateThread,
  getPendingChatStreams,
}: DispatchContext) => {
  const {
    intentHandler,
    critiqueHandler,
    critiqueStreamHandler,
    conversationHandler,
  } = createDispatchHandlers();

  const registry: Partial<Record<Task["kind"], DispatchHandler[]>> = {
    "chat.generate": [conversationHandler],
    "chat.stream": [critiqueStreamHandler, conversationHandler],
    "chat.intent": [intentHandler],
    "chat.unbiased_critique": [critiqueHandler],
    "chat.biased_critique": [critiqueHandler],
  };

  const context: DispatchContext = {
    task,
    taskKind,
    thread,
    promptMode,
    moodId,
    requestedContextLength,
    isPersistentConversation,
    compactThresholdRatio,
    getChatModelKey,
    setGroupTaskStatusByKind,
    updateRunningTask,
    updateChatTaskPayload,
    updateThread,
    getPendingChatStreams,
  };

  const handlers = registry[taskKind] ?? [];
  for (const handler of handlers) {
    if (await handler(context)) {
      return true;
    }
  }
  return false;
};
