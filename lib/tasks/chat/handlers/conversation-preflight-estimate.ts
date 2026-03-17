import { getGeneratedImagesForThread } from "@/lib/comfy/thread-generated-images";
import { getAdaptiveGeneratedImageLimit } from "@/lib/tasks/chat/lm-input";
import {
  estimateImageTokens,
  estimateMessageTokens,
} from "@/lib/tasks/chat/policies/context-budget";
import type { TaskGroup } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

type ConversationTask = ChatTask & {
  payload: Extract<ChatTask["payload"], { kind: "conversation" }>;
};

export const resolveConversationTaskForPreflight = ({
  task,
  taskKind,
  isPersistentConversation,
  thread,
}: {
  task: ChatTask;
  taskKind: "chat.generate" | "chat.stream";
  isPersistentConversation: boolean;
  thread:
    | {
        messages: Array<{
          role: "user" | "assistant" | "system";
          content: import("@/lib/chat/message-content").MessagePart[];
        }>;
        contextWindowUsedTokens: number | null;
      }
    | null;
}) => {
  if (
    !(
      taskKind === "chat.generate" &&
      task.payload.threadId &&
      task.payload.kind === "conversation" &&
      isPersistentConversation &&
      thread
    )
  ) {
    return null;
  }

  return task as ConversationTask;
};

export const estimateConversationProjectedTokenUsage = ({
  task,
  thread,
  requestedContextLength,
}: {
  task: ConversationTask;
  thread: {
    messages: Array<{
      role: "user" | "assistant" | "system";
      content: import("@/lib/chat/message-content").MessagePart[];
    }>;
    contextWindowUsedTokens: number | null;
  };
  requestedContextLength: number;
}) => {
  const generatedImageLimitForEstimate = getAdaptiveGeneratedImageLimit({
    contextLength: requestedContextLength,
    userMessage: task.payload.userMessage,
  });
  const generatedImagesForEstimate = getGeneratedImagesForThread(
    thread.messages,
    generatedImageLimitForEstimate,
  );

  const estimatedUpcomingTokens =
    estimateMessageTokens(task.payload.userMessage) +
    estimateImageTokens(generatedImagesForEstimate) +
    estimateImageTokens(task.payload.userMessage);
  const projectedUsedTokens =
    thread.contextWindowUsedTokens === null
      ? null
      : thread.contextWindowUsedTokens + estimatedUpcomingTokens;

  return {
    projectedUsedTokens,
  };
};
