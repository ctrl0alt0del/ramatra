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
  if (regenerateOfLastAssistant) {
    return {
      appendMessages: [
        {
          role: "assistant" as const,
          content: [{ type: "text" as const, text: textWithCompactionMarkers }],
        },
      ],
    };
  }

  const lastMessage = latestMessages?.at(-1);
  const shouldAppendAssistantMessage =
    !lastMessage ||
    lastMessage.role !== "assistant" ||
    getTextFromMessageContent(lastMessage.content) !== textWithCompactionMarkers;

  return {
    appendMessages: shouldAppendAssistantMessage
      ? [
          {
            role: "assistant" as const,
            content: [{ type: "text" as const, text: textWithCompactionMarkers }],
          },
        ]
      : undefined,
  };
};
