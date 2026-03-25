import { parseChatStreamCommandFromOutputs } from "@/lib/tasks/chat/util-commands";
import { continueConversationUtilCommandInGroup } from "@/lib/tasks/chat/util/command-chain";
import { applyCompactionMarkersToText } from "@/lib/tasks/chat/text/compaction-markers";
import type {
  ChatResponse,
  ChatTask,
  ConversationRuntimeDeps,
  RuntimeThreadSnapshot,
} from "@/lib/tasks/chat/handlers/conversation-runtime.types";

export const continueConversationRuntimeUtilCommandIfNeeded = ({
  task,
  thread,
  finalResponse,
  text,
  reasoning,
  inRequestCompactionBreakOffsets,
  summaryCallsInCurrentRequest,
  buildUtilHistorySnapshot,
  updateChatTaskPayload,
  setGroupTaskStatusByKind,
  updateRunningTask,
}: {
  task: ChatTask;
  thread: RuntimeThreadSnapshot;
  finalResponse: ChatResponse | null;
  text: string;
  reasoning: string;
  inRequestCompactionBreakOffsets: number[];
  summaryCallsInCurrentRequest: number;
  buildUtilHistorySnapshot: ConversationRuntimeDeps["buildUtilHistorySnapshot"];
  updateChatTaskPayload: ConversationRuntimeDeps["updateChatTaskPayload"];
  setGroupTaskStatusByKind: ConversationRuntimeDeps["setGroupTaskStatusByKind"];
  updateRunningTask: ConversationRuntimeDeps["updateRunningTask"];
}) => {
  let parsedCommand = parseChatStreamCommandFromOutputs({
    text,
    reasoning,
    allowReasoningFallback: false,
  });
  console.info("[chat-runner] util-command:parse-result", {
    taskGroupId: task.id,
    threadId: task.payload.threadId ?? null,
    utilTaskName:
      task.payload.kind === "conversation" ? (task.payload.utilTaskName ?? null) : null,
    source: parsedCommand.source,
    hasCommand: Boolean(parsedCommand.command),
    stage: parsedCommand.command?.stage ?? null,
    textPreview: text.slice(0, 400),
    reasoningPreview: reasoning.slice(0, 400),
  });

  if (task.payload.kind !== "conversation") {
    return {
      continued: false,
      parsedCommand,
    };
  }

  const conversationCommandResult = continueConversationUtilCommandInGroup({
    task,
    thread,
    parsedCommand,
    finalResponseId: finalResponse?.response_id ?? null,
    reasoning,
    inRequestCompactionBreakOffsets,
    summaryCallsInCurrentRequest,
    existingTaskResult: (task.result ?? null) as Record<string, unknown> | null,
    applyCompactionMarkersToText,
    buildUtilHistorySnapshot,
    updateChatTaskPayload,
    setGroupTaskStatusByKind,
    updateRunningTask,
  });

  parsedCommand = conversationCommandResult.parsedCommand;
  if (!conversationCommandResult.continued) {
    console.info("[chat-runner] util-command:not-continued", {
      taskGroupId: task.id,
      threadId: task.payload.threadId ?? null,
      utilTaskName: task.payload.utilTaskName ?? null,
      source: parsedCommand.source,
      hasCommand: Boolean(parsedCommand.command),
      stage: parsedCommand.command?.stage ?? null,
      cleanTextPreview: parsedCommand.cleanText.slice(0, 300),
    });
  }
  return {
    continued: conversationCommandResult.continued,
    parsedCommand,
  };
};
