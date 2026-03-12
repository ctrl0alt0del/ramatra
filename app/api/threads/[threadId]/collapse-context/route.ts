import { NextResponse } from "next/server";

import { isPromptMode } from "@/lib/lmstudio/prompt-modes";
import { getThread } from "@/lib/lmstudio/threads";
import { processTaskQueues } from "@/lib/tasks/processor";
import { enqueueChatTask } from "@/lib/tasks/scheduler";
import { getTask } from "@/lib/tasks/store";

type RouteContext = {
  params: Promise<{ threadId: string }>;
};

const waitForTaskCompletion = async (taskId: string, timeoutMs = 30000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const task = getTask(taskId);
    if (!task) {
      throw new Error("Task not found.");
    }

    if (
      task.status === "completed" ||
      task.status === "failed" ||
      task.status === "cancelled"
    ) {
      return task;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error("Timed out waiting for context collapse.");
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
    const task = enqueueChatTask({
      kind: "collapse_context",
      threadId,
      promptMode: json.promptMode,
    });

    void processTaskQueues();
    const completedTask = await waitForTaskCompletion(task.id);

    if (completedTask.status !== "completed") {
      return NextResponse.json(
        {
          error: completedTask.error ?? "Failed to collapse thread context.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      thread: getThread(threadId),
      summaryCollapsed: completedTask.result?.summaryCollapsed ?? false,
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
