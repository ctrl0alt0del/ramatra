export type TextMessagePart = {
  type: "text";
  text: string;
};

export type ImageMessagePart = {
  type: "image";
  dataUrl: string;
  mimeType?: string;
  name?: string;
};

export type MessagePart = TextMessagePart | ImageMessagePart;

const isTextPart = (value: unknown): value is TextMessagePart => {
  return (
    !!value &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "text" &&
    "text" in value &&
    typeof value.text === "string"
  );
};

const isImagePart = (value: unknown): value is ImageMessagePart => {
  return (
    !!value &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "image" &&
    "dataUrl" in value &&
    typeof value.dataUrl === "string"
  );
};

export const isMessagePart = (value: unknown): value is MessagePart => {
  return isTextPart(value) || isImagePart(value);
};

export const normalizeMessageContent = (value: unknown): MessagePart[] => {
  if (typeof value === "string") {
    return value.trim() ? [{ type: "text", text: value }] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => (isMessagePart(item) ? [item] : []));
};

export const serializeMessageContent = (parts: MessagePart[]) => {
  return JSON.stringify(parts);
};

export const parseStoredMessageContent = (raw: string) => {
  try {
    return normalizeMessageContent(JSON.parse(raw));
  } catch {
    return normalizeMessageContent(raw);
  }
};

export const getTextFromMessageContent = (parts: MessagePart[]) => {
  return parts
    .flatMap((part) => (part.type === "text" ? [part.text.trim()] : []))
    .filter(Boolean)
    .join("\n\n");
};

export const hasUsableMessageContent = (parts: MessagePart[]) => {
  return parts.some((part) => {
    if (part.type === "text") {
      return part.text.trim().length > 0;
    }

    return part.dataUrl.trim().length > 0;
  });
};

export const formatMessageContentForPrompt = (parts: MessagePart[]) => {
  const text = getTextFromMessageContent(parts);
  const imageCount = parts.filter((part) => part.type === "image").length;

  if (!imageCount) {
    return text;
  }

  const imageLabel = imageCount === 1 ? "[Image attached]" : `[${imageCount} images attached]`;
  return [text, imageLabel].filter(Boolean).join("\n");
};
