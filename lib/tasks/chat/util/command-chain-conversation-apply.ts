import { setConversationGenerateAndStreamPending } from "@/lib/tasks/chat/handlers/task-status-transitions";
import type { ParsedUtilCommandResult } from "@/lib/tasks/chat/util/command-chain-types";
import type { TaskGroupPayloadMap } from "@/lib/tasks/types";

export const applyConversationUtilDelegation = ({
  taskId,
  delegation,
  reasoning,
  finalResponseId,
  summaryCallsInCurrentRequest,
  existingTaskResult,
  updateChatTaskPayload,
  setGroupTaskStatusByKind,
  updateRunningTask,
}: {
  taskId: string;
  delegation: {
    accepted: true;
    parsedCommand: ParsedUtilCommandResult;
    utilTaskName: string;
    delegatedText: string;
    updatedConversationPayload: TaskGroupPayloadMap["chat"];
    utilEnqueueCount: number;
  };
  reasoning: string;
  finalResponseId: string | null;
  summaryCallsInCurrentRequest: number;
  existingTaskResult: Record<string, unknown> | null;
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
}) => {
  updateChatTaskPayload(taskId, delegation.updatedConversationPayload);
  setConversationGenerateAndStreamPending({
    taskId,
    setGroupTaskStatusByKind,
  });

  updateRunningTask(taskId, {
    result: {
      ...(existingTaskResult ?? {}),
      text: delegation.delegatedText,
      reasoning,
      responseId: finalResponseId,
      summaryCallsInCurrentRequest,
    },
  });

  console.info("[chat-runner] util-command:continued-in-group", {
    taskGroupId: taskId,
    utilTaskName: delegation.utilTaskName,
    utilEnqueueCount: delegation.utilEnqueueCount,
  });
};
