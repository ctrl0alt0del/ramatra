import { getTextFromMessageContent } from "@/lib/chat/message-content";
import type { MessagePart } from "@/lib/chat/message-content";

type ThreadMessage = {
  role: "user" | "assistant" | "system";
  content: MessagePart[];
};

export const buildConversationAssistantMessagePlan = ({
  latestMessages,
  textWithCompactionMarkers,
  regenerateOfLastAssistant,
}: {
  latestMessages: ThreadMessage[] | null;
  textWithCompactionMarkers: string;
  regenerateOfLastAssistant: boolean;
}) => {
  const lastMessage = latestMessages?.at(-1);
  const shouldReplaceLastAssistant =
    regenerateOfLastAssistant &&
    !!latestMessages &&
    latestMessages.length > 0 &&
    latestMessages.at(-1)?.role === "assistant";

  const shouldAppendAssistantMessage =
    !shouldReplaceLastAssistant &&
    (!lastMessage ||
      lastMessage.role !== "assistant" ||
      getTextFromMessageContent(lastMessage.content) !== textWithCompactionMarkers);

  const replaceMessages =
    shouldReplaceLastAssistant && latestMessages
      ? [
          ...latestMessages.slice(0, -1),
          {
            role: "assistant" as const,
            content: [
              { type: "text" as const, text: textWithCompactionMarkers },
            ],
          },
        ]
      : undefined;
  const appendMessages = shouldAppendAssistantMessage
    ? [
        {
          role: "assistant" as const,
          content: [{ type: "text" as const, text: textWithCompactionMarkers }],
        },
      ]
    : undefined;

  return {
    replaceMessages,
    appendMessages,
  };
};
