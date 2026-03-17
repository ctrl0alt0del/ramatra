import type { MessagePart } from "@/lib/chat/message-content";
import { parseUtilPromptFlags } from "@/lib/tasks/chat/util-commands";
import type { ChatStreamCommand } from "@/lib/tasks/chat/util/command-parser.types";

export const buildUtilDelegationContext = ({
  utilPrompt,
  command,
  utilUserMessageSeed,
  thread,
  buildUtilHistorySnapshot,
}: {
  utilPrompt: string;
  command: ChatStreamCommand;
  utilUserMessageSeed: MessagePart[];
  thread: {
    messages: Array<{
      role: "user" | "assistant" | "system";
      content: MessagePart[];
    }>;
  } | null;
  buildUtilHistorySnapshot: (args: {
    thread: {
      messages: Array<{
        role: "user" | "assistant" | "system";
        content: MessagePart[];
      }>;
    } | null;
    currentUserMessage: MessagePart[];
  }) => string;
}) => {
  const utilSystemPromptExt =
    typeof command.context_text === "string" ? command.context_text.trim() : "";
  const utilPromptFlags = parseUtilPromptFlags(utilPrompt);
  const utilHistorySnapshot = buildUtilHistorySnapshot({
    thread,
    currentUserMessage: utilUserMessageSeed,
  });
  const useStatelessContext = command.stateless === true || utilPromptFlags.isStateless;
  const delegatedUserMessage = useStatelessContext ? [] : utilUserMessageSeed;
  const delegatedSystemPrompt = [
    utilSystemPromptExt,
    ...(useStatelessContext ? [] : [utilHistorySnapshot]),
    utilPromptFlags.prompt,
  ]
    .filter((value) => value.length > 0)
    .join("\n\n");

  return {
    useStatelessContext,
    delegatedUserMessage,
    delegatedSystemPrompt,
    utilSystemPromptExt,
  };
};
