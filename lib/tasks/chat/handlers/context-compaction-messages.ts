import type { MessagePart } from "@/lib/chat/message-content";

export const buildMessagesForSummaryCompaction = ({
  unsummarizedMessages,
  interruptedAssistantFullText,
}: {
  unsummarizedMessages: Array<{
    role: "user" | "assistant" | "system";
    content: MessagePart[];
  }>;
  interruptedAssistantFullText: string;
}) =>
  interruptedAssistantFullText.trim().length > 0
    ? [
        ...unsummarizedMessages,
        {
          role: "assistant" as const,
          content: [{ type: "text" as const, text: interruptedAssistantFullText.trim() }],
        },
      ]
    : unsummarizedMessages;
