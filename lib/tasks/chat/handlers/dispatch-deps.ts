import { requestLmStudioChat } from "@/lib/tasks/chat/adapters/lm-studio-client";
import { handleCritiqueStreamTask } from "@/lib/tasks/chat/handlers/critique-stream";
import { executeCritiqueTask } from "@/lib/tasks/chat/handlers/critique";
import { executeIntentTask } from "@/lib/tasks/chat/handlers/intent";
import { executeConversationDispatch } from "@/lib/tasks/chat/handlers/conversation-dispatch";
import { getAssistantReasoning, getAssistantText } from "@/lib/tasks/chat/output";
import { intentUpdateSystemPrompt } from "@/lib/tasks/chat/prompts";
import {
  normalizeIntentToNaturalLanguage,
  balanceIntentWithPrevious,
} from "@/lib/tasks/chat/intent-normalization";
import { buildUtilHistorySnapshot } from "@/lib/tasks/chat/util-history";
import type { DispatchContext, DispatchHandler } from "@/lib/tasks/chat/handlers/dispatch.types";

export const createDispatchHandlers = (): {
  intentHandler: DispatchHandler;
  critiqueHandler: DispatchHandler;
  critiqueStreamHandler: DispatchHandler;
  conversationHandler: DispatchHandler;
} => {
  const intentHandler: DispatchHandler = async (context: DispatchContext) =>
    executeIntentTask({
      task: context.task,
      taskKind: context.taskKind,
      requestedContextLength: context.requestedContextLength,
      intentUpdateSystemPrompt,
      getChatModelKey: context.getChatModelKey,
      requestLmStudioChat,
      getAssistantText,
      normalizeIntentToNaturalLanguage,
      balanceIntentWithPrevious,
    });

  const critiqueHandler: DispatchHandler = async (context: DispatchContext) =>
    executeCritiqueTask({
      task: context.task,
      taskKind: context.taskKind,
      requestedContextLength: context.requestedContextLength,
      moodId: context.moodId,
      getChatModelKey: context.getChatModelKey,
      requestLmStudioChat,
      getAssistantText,
      getAssistantReasoning,
    });

  const critiqueStreamHandler: DispatchHandler = (context: DispatchContext) =>
    handleCritiqueStreamTask({
      task: context.task,
      requestedContextLength: context.requestedContextLength,
      moodId: context.moodId,
      buildUtilHistorySnapshot,
      updateChatTaskPayload: context.updateChatTaskPayload,
      updateRunningTask: context.updateRunningTask,
      setGroupTaskStatusByKind: ({ taskId, kind, status }) =>
        context.setGroupTaskStatusByKind({ taskId, kind, status }),
    });

  const conversationHandler: DispatchHandler = (context: DispatchContext) =>
    executeConversationDispatch({
      task: context.task,
      taskKind:
        context.taskKind === "chat.generate" ? "chat.generate" : "chat.stream",
      thread: context.thread,
      promptMode: context.promptMode,
      moodId: context.moodId,
      requestedContextLength: context.requestedContextLength,
      isPersistentConversation: context.isPersistentConversation,
      compactThresholdRatio: context.compactThresholdRatio,
      getChatModelKey: context.getChatModelKey,
      setGroupTaskStatusByKind: context.setGroupTaskStatusByKind,
      updateRunningTask: context.updateRunningTask,
      updateChatTaskPayload: context.updateChatTaskPayload,
      updateThread: context.updateThread,
      getPendingChatStreams: context.getPendingChatStreams,
    });

  return {
    intentHandler,
    critiqueHandler,
    critiqueStreamHandler,
    conversationHandler,
  };
};
