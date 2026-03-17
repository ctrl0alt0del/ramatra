import { getTextFromMessageContent, type MessagePart } from "@/lib/chat/message-content";

const DEFAULT_ESTIMATED_IMAGE_TOKENS_PER_ATTACHMENT = 1024;

export const estimateMessageTokens = (message: MessagePart[]) => {
  const textLength = getTextFromMessageContent(message).length;
  return Math.ceil(textLength / 3.5);
};

export const getEstimatedImageTokensPerAttachment = () => {
  const parsed = Number.parseInt(
    process.env.LM_STUDIO_ESTIMATED_IMAGE_TOKENS_PER_ATTACHMENT ??
      String(DEFAULT_ESTIMATED_IMAGE_TOKENS_PER_ATTACHMENT),
    10,
  );

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_ESTIMATED_IMAGE_TOKENS_PER_ATTACHMENT;
  }

  return parsed;
};

export const estimateImageTokens = (parts: MessagePart[]) => {
  const imageCount = parts.filter((part) => part.type === "image").length;
  if (imageCount <= 0) {
    return 0;
  }
  return imageCount * getEstimatedImageTokensPerAttachment();
};

export const shouldCompactForRatio = ({
  usedTokens,
  totalTokens,
  compactThresholdRatio,
}: {
  usedTokens: number | null;
  totalTokens: number;
  compactThresholdRatio: number;
}) => {
  if (usedTokens === null || totalTokens <= 0) {
    return false;
  }

  return usedTokens / totalTokens >= compactThresholdRatio;
};
