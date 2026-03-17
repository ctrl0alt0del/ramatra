import type { MessagePart } from "@/lib/chat/message-content";

export const buildUtilDelegationContext = ({
  commandContextText,
  utilPromptText,
  commandStateless,
  utilPromptStateless,
  utilUserMessageSeed,
  thread,
  buildUtilHistorySnapshot,
}: {
  commandContextText: string | undefined;
  utilPromptText: string;
  commandStateless: boolean;
  utilPromptStateless: boolean;
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
  const utilSystemPromptExt = commandContextText?.trim() ?? "";
  const utilHistorySnapshot = buildUtilHistorySnapshot({
    thread,
    currentUserMessage: utilUserMessageSeed,
  });
  const useStatelessContext = commandStateless || utilPromptStateless;
  const delegatedUserMessage = useStatelessContext ? [] : utilUserMessageSeed;
  const delegatedSystemPrompt = [
    utilSystemPromptExt,
    ...(useStatelessContext ? [] : [utilHistorySnapshot]),
    utilPromptText,
  ]
    .filter((value) => value.length > 0)
    .join("\n\n");

  return {
    utilSystemPromptExt,
    delegatedUserMessage,
    delegatedSystemPrompt,
  };
};
