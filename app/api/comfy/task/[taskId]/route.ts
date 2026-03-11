import { getStoredGeneration } from "@/lib/comfy/generations";
import { getTask } from "@/lib/tasks/store";

type RouteContext = {
  params: Promise<{ taskId: string }>;
};

export async function GET(_req: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const task = getTask(taskId);

  if (!task || task.type !== "comfy") {
    return Response.json(
      {
        taskId,
        status: "failed",
        error: "Comfy task not found.",
      },
      { status: 404 },
    );
  }

  if (task.status === "failed" || task.status === "cancelled") {
    return Response.json({
      taskId,
      jobId: task.result?.jobId ?? null,
      status: "failed",
      error: task.error ?? "Generation failed.",
    });
  }

  if (task.status === "queued" || task.status === "running") {
    return Response.json({
      taskId,
      jobId: task.result?.jobId ?? null,
      status: task.result?.status ?? task.status,
      progress: task.result?.progress ?? {
        value: null,
        max: null,
        percentage: null,
        node: null,
      },
    });
  }

  const jobId = task.result?.jobId;
  if (!jobId) {
    return Response.json({
      taskId,
      jobId: null,
      status: "completed",
      images: [],
    });
  }

  const stored = getStoredGeneration(jobId);
  if (!stored) {
    return Response.json({
      taskId,
      jobId,
      status: "completed",
      images: [],
    });
  }

  if (stored.status === "completed") {
    return Response.json({
      taskId,
      jobId,
      status: "completed",
      images: stored.images,
    });
  }

  if (stored.status === "failed") {
    return Response.json({
      taskId,
      jobId,
      status: "failed",
      error: stored.error ?? "Generation failed.",
    });
  }

  return Response.json({
    taskId,
    jobId,
    status: stored.status,
    progress: stored.progress,
  });
}
