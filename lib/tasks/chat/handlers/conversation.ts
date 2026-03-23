import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import { shouldCompactForRatio } from "@/lib/tasks/chat/policies/context-budget";
import { getUsedContextTokens } from "@/lib/tasks/chat/policies/stream-stop";
import { threadRepository } from "@/lib/tasks/chat/adapters/thread-repository";
import { taskOrchestration } from "@/lib/tasks/chat/adapters/task-orchestration";
import { buildConversationAssistantMessagePlan } from "@/lib/tasks/chat/handlers/conversation-persist-message-plan";
import type { TaskGroup } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export const persistConversationStreamResult = ({
  task,
  finalResponse,
  textWithCompactionMarkers,
  promptMode,
  moodId,
  requestedContextLength,
  continuationCount,
  compactThresholdRatio,
}: {
  task: ChatTask;
  finalResponse: {
    response_id?: string | null;
    model_instance_id?: string | null;
    usage?: Record<string, unknown>;
    stats?: Record<string, unknown>;
  } | null;
  textWithCompactionMarkers: string;
  promptMode: PromptMode;
  moodId: string | null;
  requestedContextLength: number;
  continuationCount: number;
  compactThresholdRatio: number;
}) => {
  if (
    task.payload.kind !== "conversation" ||
    !task.payload.threadId ||
    task.payload.persistent === false
  ) {
    return;
  }

  const latestThread = threadRepository.getById(task.payload.threadId);
  const usedContextTokens = getUsedContextTokens(finalResponse);
  const { appendMessages } = buildConversationAssistantMessagePlan({
    latestMessages: latestThread?.messages ?? null,
    textWithCompactionMarkers,
    regenerateOfLastAssistant: task.payload.regenerateOfLastAssistant === true,
    assistantLmstudioResponseId: finalResponse?.response_id ?? null,
  });
  const isPersistentUtilConversation =
    typeof task.payload.utilTaskName === "string" &&
    task.payload.utilTaskName.trim().length > 0;

  const updatedThread = threadRepository.updateById(task.payload.threadId, {
    lmstudioResponseId: isPersistentUtilConversation
      ? (latestThread?.lmstudioResponseId ?? null)
      : (finalResponse?.response_id ?? null),
    lmstudioModelInstanceId: isPersistentUtilConversation
      ? (latestThread?.lmstudioModelInstanceId ?? null)
      : (finalResponse?.model_instance_id ?? null),
    lastPromptMode: promptMode,
    lastMoodId: moodId,
    contextWindowUsedTokens: usedContextTokens,
    contextWindowTotalTokens: requestedContextLength,
    appendParentMessageId:
      task.payload.appendParentMessageId !== undefined
        ? task.payload.appendParentMessageId
        : undefined,
    appendMessages,
    regenerateOfLastAssistant: task.payload.regenerateOfLastAssistant === true,
  });

  if (
    shouldCompactForRatio({
      usedTokens: usedContextTokens ?? updatedThread?.contextWindowUsedTokens ?? null,
      totalTokens: requestedContextLength,
      compactThresholdRatio,
    })
  ) {
    const compactTask = taskOrchestration.enqueueChatTask({
      kind: "collapse_context",
      threadId: task.payload.threadId,
      promptMode,
      moodId,
      contextLength: requestedContextLength * 2,
    });
    console.info("[chat-runner] summary:triggered", {
      taskId: compactTask.id,
      threadId: task.payload.threadId,
      phase: "after",
      continuationIndex: continuationCount + 1,
    });
  }
};
