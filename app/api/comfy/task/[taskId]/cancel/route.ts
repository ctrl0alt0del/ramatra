import { NextResponse } from "next/server";

import { getClient } from "@/lib/comfy/client";
import { processTaskQueues } from "@/lib/tasks/processor";
import { cancelTask } from "@/lib/tasks/scheduler";
import { getTask } from "@/lib/tasks/store";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ taskId: string }>;
};

export async function POST(_req: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const task = getTask(taskId);

  if (!task || task.type !== "comfy") {
    return NextResponse.json({ error: "Comfy task not found." }, { status: 404 });
  }

  if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
    return NextResponse.json({
      taskId,
      cancelled: false,
      status: task.status,
    });
  }

  if (task.status === "running" && typeof task.result?.jobId === "string") {
    try {
      const client = await getClient();
      await client.interrupt();
    } catch {
      // Ignore interrupt failures; scheduler cancellation still unblocks UI/task queue.
    }
  }

  cancelTask(taskId, "Generation cancelled by user.");
  void processTaskQueues();

  return NextResponse.json({
    taskId,
    cancelled: true,
    status: "cancelled",
  });
}

