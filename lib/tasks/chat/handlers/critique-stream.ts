import { threadRepository } from "@/lib/tasks/chat/adapters/thread-repository";
import { parseChatStreamCommandFromOutputs } from "@/lib/tasks/chat/util-commands";
import { continueCritiqueUtilCommandInGroup } from "@/lib/tasks/chat/util/command-chain";
import type { TaskGroup, TaskGroupPayloadMap, TaskGroupResultMap } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export const handleCritiqueStreamTask = ({
  task,
  requestedContextLength,
  moodId,
  buildUtilHistorySnapshot,
  updateChatTaskPayload,
  updateRunningTask,
  setGroupTaskStatusByKind,
  continueCritiqueCommand = continueCritiqueUtilCommandInGroup,
}: {
  task: ChatTask;
  requestedContextLength: number;
  moodId: string | null;
  buildUtilHistorySnapshot: (args: {
    thread: {
      messages: Array<{
        role: "user" | "assistant" | "system";
        content: import("@/lib/chat/message-content").MessagePart[];
      }>;
    } | null;
    currentUserMessage: import("@/lib/chat/message-content").MessagePart[];
  }) => string;
  updateChatTaskPayload: (
    taskId: string,
    payload: TaskGroupPayloadMap["chat"],
  ) => unknown;
  updateRunningTask: (
    taskId: string,
    patch: {
      result: TaskGroupResultMap["chat"];
    },
  ) => void;
  setGroupTaskStatusByKind: (args: {
    taskId: string;
    kind: "chat.stream";
    status: "completed";
  }) => void;
  continueCritiqueCommand?: typeof continueCritiqueUtilCommandInGroup;
}) => {
  if (!(task.payload.kind === "critique")) {
    return false;
  }

  const text = task.result?.text ?? "";
  const reasoning = task.result?.reasoning ?? "";
  const parsedCommand = parseChatStreamCommandFromOutputs({
    text,
    reasoning,
    allowReasoningFallback: false,
  });

  const critiqueUtilContinue = continueCritiqueCommand({
    task,
    parsedCommand,
    requestedContextLength,
    moodId,
    savedIntent: task.payload.threadId
      ? (threadRepository.getById(task.payload.threadId)?.userIntent ?? "")
      : "",
    unbiasedCritique: task.result?.unbiasedCritique ?? "",
    thread: task.payload.threadId
      ? threadRepository.getById(task.payload.threadId)
      : null,
    buildUtilHistorySnapshot,
    updateChatTaskPayload,
  });
  if (critiqueUtilContinue.continued) {
    return true;
  }

  updateRunningTask(task.id, {
    result: {
      ...(task.result ?? {}),
      text,
      reasoning,
      responseId: task.result?.responseId ?? null,
      summaryCallsInCurrentRequest: 0,
    },
  });
  setGroupTaskStatusByKind({
    taskId: task.id,
    kind: "chat.stream",
    status: "completed",
  });
  return true;
};
