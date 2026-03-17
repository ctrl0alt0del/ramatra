import {
  formatMessageContentForPrompt,
  getTextFromMessageContent,
  type MessagePart,
} from "@/lib/chat/message-content";
import { buildFreshChainInput } from "@/lib/lmstudio/summaries";
import type { LmStudioInputItem } from "@/lib/tasks/chat/input/types";

const toLmStudioInputItems = (
  parts: MessagePart[],
  imageParts: Extract<MessagePart, { type: "image" }>[], 
): LmStudioInputItem[] => {
  const text = getTextFromMessageContent(parts).trim();

  const items: LmStudioInputItem[] = [];

  if (text) {
    items.push({
      type: "text",
      content: text,
    });
  }

  items.push(
    ...imageParts.map((part) => ({
      type: "image" as const,
      data_url: part.dataUrl,
    })),
  );

  if (!items.length) {
    items.push({
      type: "text",
      content: formatMessageContentForPrompt(parts),
    });
  }

  return items;
};

export const buildLmStudioInput = ({
  summary,
  previousResponseId,
  generatedImages,
  userMessage,
}: {
  summary: string | null;
  previousResponseId: string | null;
  generatedImages: MessagePart[];
  userMessage: MessagePart[];
}): string | LmStudioInputItem[] => {
  const imageParts = [
    ...generatedImages.filter(
      (part): part is Extract<MessagePart, { type: "image" }> =>
        part.type === "image",
    ),
    ...userMessage.filter(
      (part): part is Extract<MessagePart, { type: "image" }> =>
        part.type === "image",
    ),
  ];

  if (previousResponseId) {
    return toLmStudioInputItems(userMessage, imageParts);
  }

  const text = buildFreshChainInput({
    summary,
    userInput: getTextFromMessageContent(userMessage),
  });

  if (!imageParts.length) {
    return text;
  }

  return [
    {
      type: "text",
      content: [
        text,
        generatedImages.length
          ? "Use the attached image(s), including recent generated results from this conversation, together with the user request."
          : "Use the attached image(s) together with the user request.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
    ...imageParts.map((part) => ({
      type: "image" as const,
      data_url: part.dataUrl,
    })),
  ];
};

const estimateRemainingContextRatio = ({
  contextLength,
  userMessage,
}: {
  contextLength: number;
  userMessage: MessagePart[];
}) => {
  const messageTextLength = getTextFromMessageContent(userMessage).length;
  const estimatedUsedTokens = Math.ceil(messageTextLength / 3.5);
  const remaining = Math.max(0, contextLength - estimatedUsedTokens);

  return remaining / Math.max(contextLength, 1);
};

export const getAdaptiveGeneratedImageLimit = ({
  contextLength,
  userMessage,
}: {
  contextLength: number;
  userMessage: MessagePart[];
}) => {
  const remainingRatio = estimateRemainingContextRatio({
    contextLength,
    userMessage,
  });

  if (remainingRatio < 0.25) {
    return 1;
  }

  if (remainingRatio < 0.5) {
    return 2;
  }

  return 3;
};
