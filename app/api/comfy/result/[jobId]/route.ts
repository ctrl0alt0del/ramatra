import { getClient } from "@/lib/comfy/client";
import {
  getStoredGeneration,
  markGenerationFailed,
} from "@/lib/comfy/generations";
import { ComfyJobStatus, getWorkflowStatus } from "@/lib/comfy/runner";
import { updateComfyTaskForJob } from "@/lib/tasks/scheduler";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_req: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const stored = getStoredGeneration(jobId);

  if (stored?.status === "completed") {
    updateComfyTaskForJob(jobId, {
      status: "completed",
    });
    return Response.json({
      jobId: stored.jobId,
      status: stored.status,
      images: stored.images,
    });
  }

  if (stored?.status === "failed") {
    updateComfyTaskForJob(jobId, {
      status: "failed",
      error: stored.error ?? "Generation failed",
    });
    return Response.json({
      jobId: stored.jobId,
      status: stored.status,
      error: stored.error ?? "Generation failed",
    });
  }

  if (stored?.status === "queued" || stored?.status === "running") {
    updateComfyTaskForJob(jobId, {
      status: stored.status,
      progress: stored.progress,
    });
  }

  try {
    const result = await getWorkflowStatus(await getClient(), jobId);

    if (result.status === ComfyJobStatus.Completed) {
      updateComfyTaskForJob(jobId, {
        status: "completed",
      });
      return Response.json({
        jobId: result.jobId,
        status: result.status,
        images: result.images,
      });
    }

    if (result.status === ComfyJobStatus.Failed) {
      markGenerationFailed(jobId, "Generation failed");
      updateComfyTaskForJob(jobId, {
        status: "failed",
        error: "Generation failed",
      });
      return Response.json(
        {
          jobId,
          status: result.status,
          error: "Generation failed",
        },
        { status: 200 },
      );
    }

    updateComfyTaskForJob(jobId, {
      status: result.status,
      progress:
        stored?.status === "queued" || stored?.status === "running"
          ? stored.progress
          : result.progress,
    });

    return Response.json({
      jobId: result.jobId,
      status: result.status,
      progress:
        stored?.status === "queued" || stored?.status === "running"
          ? stored.progress
          : result.progress,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to get generation result";

    if (stored) {
      markGenerationFailed(jobId, message);
      updateComfyTaskForJob(jobId, {
        status: "failed",
        error: message,
      });
      return Response.json({
        jobId,
        status: "failed",
        error: message,
      });
    }

    updateComfyTaskForJob(jobId, {
      status: "failed",
      error: message,
    });

    return Response.json(
      {
        jobId,
        status: "failed",
        error: message,
      },
      { status: 200 },
    );
  }
}
