import {
  formatMessageContentForPrompt,
  type MessagePart,
} from "@/lib/chat/message-content";
import { getGeneratedImagesForThread } from "@/lib/comfy/thread-generated-images";

const MAX_UTIL_HISTORY_MESSAGES = 8;
const MAX_UTIL_HISTORY_CHARS = 4_000;

type ThreadMessage = {
  role: "system" | "user" | "assistant";
  content: MessagePart[];
};

type ThreadLike = {
  messages: ThreadMessage[];
};

const getReferenceableUserImageCount = ({
  thread,
  currentUserMessage,
}: {
  thread: ThreadLike;
  currentUserMessage: MessagePart[];
}) => {
  const pool: string[] = [];

  for (const part of currentUserMessage) {
    if (part.type === "image" && part.dataUrl.trim().length > 0) {
      pool.push(part.dataUrl);
    }
  }

  if (thread) {
    for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
      const message = thread.messages[index];
      if (message.role !== "user") {
        continue;
      }

      for (const part of message.content) {
        if (part.type === "image" && part.dataUrl.trim().length > 0) {
          pool.push(part.dataUrl);
        }
      }
    }
  }

  return new Set(pool).size;
};

export const buildUtilHistorySnapshot = ({
  thread,
  currentUserMessage,
}: {
  thread: ThreadLike | null;
  currentUserMessage: MessagePart[];
}) => {
  if (!thread) {
    return "";
  }

  const recent = thread.messages
    .filter(
      (message) => message.role === "user" || message.role === "assistant",
    )
    .slice(-MAX_UTIL_HISTORY_MESSAGES)
    .map((message) => {
      const content = formatMessageContentForPrompt(message.content).trim();
      if (!content) {
        return "";
      }

      return `${message.role.toUpperCase()}: ${content}`;
    })
    .filter((line) => line.length > 0)
    .join("\n\n");
  if (!recent) {
    return "";
  }

  const clipped =
    recent.length > MAX_UTIL_HISTORY_CHARS
      ? recent.slice(recent.length - MAX_UTIL_HISTORY_CHARS)
      : recent;
  const generatedCount = getGeneratedImagesForThread(
    thread.messages,
    12,
  ).filter((part) => part.type === "image").length;
  const userCount = getReferenceableUserImageCount({
    thread,
    currentUserMessage,
  });

  return [
    "Recent natural chat history (for context):",
    clipped,
    "",
    "Referenceable imageRefs currently available:",
    `user:1..${Math.max(userCount, 0)}`,
    `generated:1..${Math.max(generatedCount, 0)}`,
    "generated:1 is the most recent generated image.",
  ].join("\n");
};
