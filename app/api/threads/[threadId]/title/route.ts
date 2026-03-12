import { NextResponse } from "next/server";

import { getThread, updateThread } from "@/lib/lmstudio/threads";

type RouteContext = {
  params: Promise<{ threadId: string }>;
};

const getLmStudioChatUrl = () => {
  const rawBaseUrl = process.env.LM_STUDIO_BASE_URL;
  if (!rawBaseUrl) {
    throw new Error("LM_STUDIO_BASE_URL is not configured.");
  }

  const url = new URL(rawBaseUrl);
  url.pathname = "/api/v1/chat";
  return url.toString();
};

const buildTitleInput = (thread: NonNullable<ReturnType<typeof getThread>>) => {
  const excerpt = thread.messages
    .slice(0, 8)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");

  return [
    "Create a short topic title for this conversation.",
    "Rules:",
    "- Return only the title.",
    "- 2 to 6 words.",
    "- Focus on the actual topic, not the first phrasing.",
    "- No quotes.",
    "- No markdown.",
    "- Avoid generic titles like New Chat or Question.",
    "",
    "Conversation:",
    excerpt,
  ].join("\n");
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

export async function POST(_req: Request, context: RouteContext) {
  const { threadId } = await context.params;
  const thread = getThread(threadId);

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  try {
    const response = await fetch(getLmStudioChatUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.LM_STUDIO_TOKEN
          ? { Authorization: `Bearer ${process.env.LM_STUDIO_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        model: process.env.LM_STUDIO_MODEL,
        system_prompt: titleSystemPrompt,
        input: buildTitleInput(thread),
      }),
    });

    if (!response.ok) {
      throw new Error(
        `LM Studio title request failed: HTTP ${response.status}`,
      );
    }

    const data = (await response.json()) as {
      output?: Array<{ type: string; content?: string }>;
    };
    const inferredTitle = normalizeTitle(getAssistantText(data.output));
    const nextTitle = inferredTitle || thread.title || "New Chat";
    const updatedThread = updateThread(threadId, { title: nextTitle });

    return NextResponse.json({
      title: updatedThread?.title ?? nextTitle,
    });
  } catch {
    return NextResponse.json({
      title: thread.title,
    });
  }
}
