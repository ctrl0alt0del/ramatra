import { normalizeUtilStageForImageChain } from "@/lib/tasks/chat/util-commands";
import type { TaskGroupPayloadMap } from "@/lib/tasks/types";
import type { ParsedUtilCommandResult } from "@/lib/tasks/chat/util/command-chain-types";

export const resolveConversationUtilCommandTransition = ({
  taskId,
  threadId,
  conversationPayload,
  parsedCommand,
}: {
  taskId: string;
  threadId: string | null;
  conversationPayload: Extract<TaskGroupPayloadMap["chat"], { kind: "conversation" }>;
  parsedCommand: ParsedUtilCommandResult;
}): ParsedUtilCommandResult => {
  let nextParsedCommand = parsedCommand;

  if (
    nextParsedCommand.command &&
    typeof conversationPayload.utilTaskName === "string" &&
    conversationPayload.utilTaskName.trim().length > 0
  ) {
    const normalizedTransition = normalizeUtilStageForImageChain({
      currentUtilTaskName: conversationPayload.utilTaskName.trim(),
      parsedStage: nextParsedCommand.command.stage,
      parsedContextText:
        typeof nextParsedCommand.command.context_text === "string"
          ? nextParsedCommand.command.context_text
          : undefined,
      currentSystemPromptExt:
        typeof conversationPayload.utilSystemPromptExt === "string"
          ? conversationPayload.utilSystemPromptExt
          : undefined,
      parsedPersistent: nextParsedCommand.command.persistent,
    });

    if (!normalizedTransition.accepted) {
      console.info("[chat-runner] util-command:rejected-transition", {
        taskGroupId: taskId,
        threadId,
        currentUtilTaskName: conversationPayload.utilTaskName,
        parsedStage: nextParsedCommand.command.stage,
        reason: normalizedTransition.reason,
        source: nextParsedCommand.source,
      });
      nextParsedCommand = {
        ...nextParsedCommand,
        command: null,
      };
    } else if (normalizedTransition.normalized) {
      const previousStage = nextParsedCommand.command.stage;
      nextParsedCommand = {
        ...nextParsedCommand,
        command: {
          ...nextParsedCommand.command,
          stage: normalizedTransition.stage,
          ...(normalizedTransition.persistent === true
            ? { persistent: true }
            : {}),
        },
      };
      console.info("[chat-runner] util-command:normalized-transition", {
        taskGroupId: taskId,
        threadId,
        currentUtilTaskName: conversationPayload.utilTaskName,
        previousStage,
        normalizedStage: normalizedTransition.stage,
        reason: normalizedTransition.reason ?? null,
        source: nextParsedCommand.source,
      });
    }
  }

  return nextParsedCommand;
};
