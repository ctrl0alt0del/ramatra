import {
  MAX_UTIL_COMMAND_DEPTH,
  MAX_UTIL_COMMAND_ENQUEUES,
  evaluateUtilChainContinuation,
} from "@/lib/tasks/chat/policies/util-chain";
import type { ParsedUtilCommandResult } from "@/lib/tasks/chat/util/command-chain-types";
import type { TaskGroupPayloadMap } from "@/lib/tasks/types";

export const validateAndLogConversationUtilCommand = ({
  taskId,
  threadId,
  conversationPayload,
  parsedCommand,
}: {
  taskId: string;
  threadId: string | null;
  conversationPayload: Extract<TaskGroupPayloadMap["chat"], { kind: "conversation" }>;
  parsedCommand: ParsedUtilCommandResult;
}) => {
  if (!parsedCommand.command) {
    return { allowed: false };
  }

  console.info("[chat-runner] util-command:parsed", {
    taskGroupId: taskId,
    threadId,
    stage: parsedCommand.command.stage,
    source: parsedCommand.source,
    persistent: parsedCommand.command.persistent === true,
    stateless: parsedCommand.command.stateless === true,
    hasContextText:
      typeof parsedCommand.command.context_text === "string" &&
      parsedCommand.command.context_text.trim().length > 0,
  });

  const commandDepth = conversationPayload.utilCommandDepth ?? 0;
  const utilEnqueueCount = conversationPayload.utilEnqueueCount ?? 0;
  const commandNonce =
    typeof parsedCommand.command.nonce === "string"
      ? parsedCommand.command.nonce.trim()
      : "";
  const knownNonces = conversationPayload.utilCommandNonces ?? [];

  const chainPolicy = evaluateUtilChainContinuation({
    commandDepth,
    utilEnqueueCount,
    commandNonce,
    knownNonces,
  });
  if (!chainPolicy.allowed) {
    if (chainPolicy.reason === "depth-limit") {
      console.info("[chat-runner] util-command:depth-limit", {
        taskId,
        commandDepth,
        maxDepth: MAX_UTIL_COMMAND_DEPTH,
      });
    } else if (chainPolicy.reason === "enqueue-limit") {
      console.info("[chat-runner] util-command:enqueue-limit", {
        taskId,
        utilEnqueueCount,
        maxEnqueues: MAX_UTIL_COMMAND_ENQUEUES,
      });
    } else {
      console.info("[chat-runner] util-command:duplicate-nonce", {
        taskId,
        nonce: commandNonce,
      });
    }

    return { allowed: false };
  }

  return { allowed: true };
};
