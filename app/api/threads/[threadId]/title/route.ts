import { NextResponse } from "next/server";

import { getThread, isPlaceholderThreadTitle } from "@/lib/lmstudio/threads";
import { processTaskQueues } from "@/lib/tasks/processor";
import {
  enqueueChatTask,
  hasPendingTitleGenerationTask,
} from "@/lib/tasks/scheduler";
import { getTask } from "@/lib/tasks/store";

type RouteContext = {
  params: Promise<{ threadId: string }>;
};

class TitleGenerationTimeoutError extends Error {
  constructor() {
    super("Timed out waiting for title generation.");
    this.name = "TitleGenerationTimeoutError";
  }
}

const waitForTaskCompletion = async (taskId: string, timeoutMs = 45000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const task = getTask(taskId);
    if (!task) {
      throw new Error("Task not found.");
    }

    if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
      return task;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new TitleGenerationTimeoutError();
};

export async function POST(_req: Request, context: RouteContext) {
  const { threadId } = await context.params;
  const thread = getThread(threadId);

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  if (thread.titleGenerated && !isPlaceholderThreadTitle(thread.title)) {
    return NextResponse.json({
      title: thread.title,
      pending: false,
    });
  }

  if (hasPendingTitleGenerationTask(threadId)) {
    return NextResponse.json(
      {
        title: thread.title,
        pending: true,
      },
      { status: 202 },
    );
  }

  try {
    const task = enqueueChatTask({
      kind: "generate_title",
      threadId,
    });

    void processTaskQueues();
    const completedTask = await waitForTaskCompletion(task.id);
    const latestThread = getThread(threadId) ?? thread;

    if (completedTask.status !== "completed") {
      return NextResponse.json({
        title: latestThread.title,
        pending: false,
        error: completedTask.error,
      });
    }

    return NextResponse.json({
      title: completedTask.result?.title ?? latestThread.title,
      pending: false,
    });
  } catch (error) {
    const latestThread = getThread(threadId) ?? thread;
    if (error instanceof TitleGenerationTimeoutError) {
      return NextResponse.json(
        {
          title: latestThread.title,
          pending: true,
        },
        { status: 202 },
      );
    }

    return NextResponse.json({
      title: latestThread.title,
      pending: false,
      error: error instanceof Error ? error.message : "Title generation failed.",
    });
  }
}
