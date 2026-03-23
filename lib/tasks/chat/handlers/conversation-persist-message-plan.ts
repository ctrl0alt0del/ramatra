import { getTextFromMessageContent } from "@/lib/chat/message-content";
import type { MessagePart } from "@/lib/chat/message-content";

type ThreadMessage = {
  role: "user" | "assistant" | "system";
  content: MessagePart[];
  lmstudioResponseId?: string | null;
};

export const buildConversationAssistantMessagePlan = ({
  latestMessages,
  textWithCompactionMarkers,
  regenerateOfLastAssistant,
  assistantLmstudioResponseId,
}: {
  latestMessages: ThreadMessage[] | null;
  textWithCompactionMarkers: string;
  regenerateOfLastAssistant: boolean;
  assistantLmstudioResponseId: string | null;
}) => {
  if (regenerateOfLastAssistant) {
    return {
      appendMessages: [
        {
          role: "assistant" as const,
          content: [{ type: "text" as const, text: textWithCompactionMarkers }],
          lmstudioResponseId: assistantLmstudioResponseId,
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
            lmstudioResponseId: assistantLmstudioResponseId,
          },
        ]
      : undefined,
  };
};
