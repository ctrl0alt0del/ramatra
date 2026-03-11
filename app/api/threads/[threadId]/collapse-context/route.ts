import { NextResponse } from "next/server";

import { isPromptMode } from "@/lib/lmstudio/prompt-modes";
import { getThread, updateThread } from "@/lib/lmstudio/threads";
import { generateConversationSummary } from "@/lib/lmstudio/summaries";

type RouteContext = {
  params: Promise<{ threadId: string }>;
};

export async function POST(req: Request, context: RouteContext) {
  const { threadId } = await context.params;
  const thread = getThread(threadId);

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const json = (await req.json().catch(() => ({}))) as {
    promptMode?: string;
  };

  if (!json.promptMode || !isPromptMode(json.promptMode)) {
    return NextResponse.json(
      { error: "A valid promptMode is required." },
      { status: 400 },
    );
  }

  const unsummarizedMessages = thread.messages.slice(thread.summaryMessageCount);

  if (!unsummarizedMessages.length) {
    return NextResponse.json({
      thread,
      summaryCollapsed: false,
      message: "No new context to collapse.",
    });
  }

  try {
    const conversationSummary = await generateConversationSummary({
      mode: json.promptMode,
      previousSummary: thread.conversationSummary,
      messages: unsummarizedMessages,
    });

    const updatedThread = updateThread(thread.id, {
      conversationSummary,
      summaryUpdatedAt: new Date().toISOString(),
      summaryMessageCount: thread.messageCount,
      lmstudioResponseId: null,
    });

    return NextResponse.json({
      thread: updatedThread,
      summaryCollapsed: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to collapse thread context.",
      },
      { status: 500 },
    );
  }
}
