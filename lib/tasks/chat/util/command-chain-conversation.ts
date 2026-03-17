import { type TaskGroup, type TaskGroupPayloadMap } from "@/lib/tasks/types";
import type { MessagePart } from "@/lib/chat/message-content";
import type { ParsedUtilCommandResult } from "@/lib/tasks/chat/util/command-chain-types";
import { resolveConversationUtilCommandTransition } from "@/lib/tasks/chat/util/command-chain-conversation-transition";
import { buildConversationUtilDelegation } from "@/lib/tasks/chat/util/command-chain-conversation-delegation";
import { validateAndLogConversationUtilCommand } from "@/lib/tasks/chat/util/command-chain-policy-check";
import { applyConversationUtilDelegation } from "@/lib/tasks/chat/util/command-chain-conversation-apply";

type ChatTaskGroup = Extract<TaskGroup, { type: "chat" }>;

export const continueConversationUtilCommandInGroup = ({
  task,
  thread,
  parsedCommand,
  finalResponseId,
  reasoning,
  inRequestCompactionBreakOffsets,
  summaryCallsInCurrentRequest,
  existingTaskResult,
  applyCompactionMarkersToText,
  buildUtilHistorySnapshot,
  updateChatTaskPayload,
  setGroupTaskStatusByKind,
  updateRunningTask,
}: {
  task: ChatTaskGroup;
  thread: {
    lmstudioResponseId: string | null;
    messages: Array<{
      role: "user" | "assistant" | "system";
      content: MessagePart[];
    }>;
  } | null;
  parsedCommand: ParsedUtilCommandResult;
  finalResponseId: string | null;
  reasoning: string;
  inRequestCompactionBreakOffsets: number[];
  summaryCallsInCurrentRequest: number;
  existingTaskResult: Record<string, unknown> | null;
  applyCompactionMarkersToText: (text: string, breakOffsets: number[]) => string;
  buildUtilHistorySnapshot: (args: {
    thread: {
      messages: Array<{
        role: "user" | "assistant" | "system";
        content: MessagePart[];
      }>;
    } | null;
    currentUserMessage: MessagePart[];
  }) => string;
  updateChatTaskPayload: (
    taskId: string,
    payload: TaskGroupPayloadMap["chat"],
  ) => unknown;
  setGroupTaskStatusByKind: (args: {
    taskId: string;
    kind: "chat.generate" | "chat.stream";
    status: "pending";
  }) => void;
  updateRunningTask: (
    taskId: string,
    patch: {
      result: {
        text: string;
        reasoning: string;
        responseId: string | null;
        summaryCallsInCurrentRequest: number;
      };
    },
  ) => void;
}): {
  continued: boolean;
  parsedCommand: ParsedUtilCommandResult;
} => {
  if (task.payload.kind !== "conversation") {
    return {
      continued: false,
      parsedCommand,
    };
  }
  const conversationPayload = task.payload;

  const nextParsedCommand = resolveConversationUtilCommandTransition({
    taskId: task.id,
    threadId: conversationPayload.threadId ?? null,
    conversationPayload,
    parsedCommand,
  });

  if (!nextParsedCommand.command) {
    return {
      continued: false,
      parsedCommand: nextParsedCommand,
    };
  }

  if (
    !validateAndLogConversationUtilCommand({
      taskId: task.id,
      threadId: task.payload.threadId ?? null,
      conversationPayload,
      parsedCommand: nextParsedCommand,
    }).allowed
  ) {
    return {
      continued: false,
      parsedCommand: nextParsedCommand,
    };
  }

  const delegation = buildConversationUtilDelegation({
    taskId: task.id,
    conversationPayload,
    parsedCommand: nextParsedCommand,
    thread,
    finalResponseId,
    reasoning,
    inRequestCompactionBreakOffsets,
    applyCompactionMarkersToText,
    buildUtilHistorySnapshot,
  });
  if (!delegation.accepted) {
    return {
      continued: false,
      parsedCommand: delegation.parsedCommand,
    };
  }

  applyConversationUtilDelegation({
    taskId: task.id,
    delegation,
    reasoning,
    finalResponseId,
    summaryCallsInCurrentRequest,
    existingTaskResult,
    updateChatTaskPayload,
    setGroupTaskStatusByKind,
    updateRunningTask,
  });

  return {
    continued: true,
    parsedCommand: nextParsedCommand,
  };
};
