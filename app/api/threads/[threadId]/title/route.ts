import { NextResponse } from "next/server";

import { getThread } from "@/lib/lmstudio/threads";
import { processTaskQueues } from "@/lib/tasks/processor";
import { enqueueChatTask } from "@/lib/tasks/scheduler";
import { getTask } from "@/lib/tasks/store";

type RouteContext = {
  params: Promise<{ threadId: string }>;
};

const waitForTaskCompletion = async (taskId: string, timeoutMs = 20000) => {
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

  throw new Error("Timed out waiting for title generation.");
};

export async function POST(_req: Request, context: RouteContext) {
  const { threadId } = await context.params;
  const thread = getThread(threadId);

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  try {
    const task = enqueueChatTask({
      kind: "generate_title",
      threadId,
    });

    void processTaskQueues();
    const completedTask = await waitForTaskCompletion(task.id);

    if (completedTask.status !== "completed") {
      return NextResponse.json({
        title: thread.title,
      });
    }

    return NextResponse.json({
      title: completedTask.result?.title ?? thread.title,
    });
  } catch {
    return NextResponse.json({
      title: thread.title,
    });
  }
}
