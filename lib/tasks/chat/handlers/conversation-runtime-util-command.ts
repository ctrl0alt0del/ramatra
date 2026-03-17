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
  return {
    continued: conversationCommandResult.continued,
    parsedCommand,
  };
};
