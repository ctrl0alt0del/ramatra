import "server-only";

import { formatMessageContentForPrompt } from "@/lib/chat/message-content";
import { messagePartsContainContextCompactionMarker } from "@/lib/chat/context-compaction-marker";
import { resolvePreferredLmStudioModelTarget } from "@/lib/lmstudio/models";
import { type ThreadDetail } from "@/lib/lmstudio/threads";

const TITLE_MESSAGE_CHAR_LIMIT = 220;

const getLmStudioChatUrl = () => {
  const rawBaseUrl = process.env.LM_STUDIO_BASE_URL;
  if (!rawBaseUrl) {
    throw new Error("LM_STUDIO_BASE_URL is not configured.");
  }

  const url = new URL(rawBaseUrl);
  url.pathname = "/api/v1/chat";
  return url.toString();
};

const clipForTitle = (value: string) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= TITLE_MESSAGE_CHAR_LIMIT) {
    return normalized;
  }

  return `${normalized.slice(0, TITLE_MESSAGE_CHAR_LIMIT - 3).trimEnd()}...`;
};

const buildTitleInput = (thread: ThreadDetail) => {
  const excerpt = thread.messages
    .filter(
      (message) =>
        !messagePartsContainContextCompactionMarker(message.content),
    )
    .slice(0, 8)
    .map(
      (message) =>
        `${message.role.toUpperCase()}: ${clipForTitle(
          formatMessageContentForPrompt(message.content),
        )}`,
    )
    .join("\n\n");

  return excerpt;
};

const titleSystemPrompt = [
  "You generate short conversation titles.",
  "Return only the final title.",
  "Do not show reasoning.",
  "Do not use long reasoning, use first draft immediately.",
  "Answer immediately with a short title.",
  "Use 2 to 6 words.",
  "No quotes.",
  "No markdown.",
].join("\n");

const getAssistantText = (
  output: Array<{ type: string; content?: string }> | undefined,
) => {
  if (!output?.length) return "";

  return output
    .flatMap((item) =>
      item.type === "message" && typeof item.content === "string"
        ? [item.content.trim()]
        : [],
    )
    .filter(Boolean)
    .join("\n\n");
};

const normalizeTitle = (title: string) => {
  return title
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
};

export const generateThreadTitle = async (thread: ThreadDetail) => {
  const response = await fetch(getLmStudioChatUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.LM_STUDIO_TOKEN
        ? { Authorization: `Bearer ${process.env.LM_STUDIO_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      model: await resolvePreferredLmStudioModelTarget({
        preferredInstanceId: thread.lmstudioModelInstanceId,
        modelKey: process.env.LM_STUDIO_MODEL!,
      }),
      system_prompt: titleSystemPrompt,
      input: buildTitleInput(thread),
    }),
  });

  if (!response.ok) {
    throw new Error(`LM Studio title request failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    output?: Array<{ type: string; content?: string }>;
  };

  return normalizeTitle(getAssistantText(data.output));
};
