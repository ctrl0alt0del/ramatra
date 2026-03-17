import { generateConversationSummary } from "@/lib/lmstudio/summaries";
import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import { shouldCompactForRatio } from "@/lib/tasks/chat/policies/context-budget";
import { threadRepository } from "@/lib/tasks/chat/adapters/thread-repository";
import { buildMessagesForSummaryCompaction } from "@/lib/tasks/chat/handlers/context-compaction-messages";
import { persistCollapsedThreadSummary } from "@/lib/tasks/chat/handlers/context-compaction-persist";

export const collapseThreadContext = async ({
  threadId,
  promptMode,
  interruption,
}: {
  threadId: string;
  promptMode: PromptMode;
  interruption?: {
    interrupted: boolean;
    interruptedAssistantTailChars?: string;
    interruptedAssistantFullText?: string;
    interruptionContext?: string;
    toolEventsTranscript?: string;
  };
}) => {
  const thread = threadRepository.getById(threadId);
  if (!thread) {
    return { collapsed: false as const, thread: null };
  }

  const unsummarizedMessages = thread.messages.slice(
    thread.summaryMessageCount,
  );
  if (!unsummarizedMessages.length) {
    return { collapsed: false as const, thread };
  }

  const messagesForSummary = buildMessagesForSummaryCompaction({
    unsummarizedMessages,
    interruptedAssistantFullText:
      interruption?.interruptedAssistantFullText ?? "",
  });

  const conversationSummary = await generateConversationSummary({
    mode: promptMode,
    modelInstanceId: thread.lmstudioModelInstanceId,
    previousSummary: thread.conversationSummary,
    messages: messagesForSummary,
    interruption,
  });

  const updatedThread = persistCollapsedThreadSummary({
    threadId: thread.id,
    conversationSummary,
  });

  return {
    collapsed: true as const,
    thread: updatedThread,
  };
};

export const maybeAutoCompactThreadContext = async ({
  threadId,
  taskId,
  promptMode,
  usedTokens,
  totalTokens,
  phase,
  continuationIndex,
  interruption,
  compactThresholdRatio,
  force = false,
}: {
  threadId: string;
  taskId: string;
  promptMode: PromptMode;
  usedTokens: number | null;
  totalTokens: number;
  phase: "before" | "after";
  continuationIndex: number;
  interruption?: {
    interrupted: boolean;
    interruptedAssistantTailChars?: string;
    interruptedAssistantFullText?: string;
    interruptionContext?: string;
    toolEventsTranscript?: string;
  };
  compactThresholdRatio: number;
  force?: boolean;
}) => {
  if (
    !force &&
    !shouldCompactForRatio({
      usedTokens,
      totalTokens,
      compactThresholdRatio,
    })
  ) {
    return {
      collapsed: false as const,
      thread: threadRepository.getById(threadId),
    };
  }

  try {
    const result = await collapseThreadContext({
      threadId,
      promptMode,
      interruption,
    });

    if (result.collapsed) {
      console.info("[chat-runner] summary:triggered", {
        taskId,
        threadId,
        phase,
        continuationIndex,
      });
    }

    return result;
  } catch (error) {
    console.error("[chat-runner] summary:failed", {
      taskId,
      threadId,
      phase,
      continuationIndex,
      error,
    });
    return {
      collapsed: false as const,
      thread: threadRepository.getById(threadId),
    };
  }
};
