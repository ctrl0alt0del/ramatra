import { getClient } from "@/lib/comfy/client";
import {
  getStoredGeneration,
  markGenerationFailed,
} from "@/lib/comfy/generations";
import { ComfyJobStatus, getWorkflowStatus } from "@/lib/comfy/runner";
import {
  registerImageGenerationFinish,
  registerImageGenerationStart,
} from "@/lib/vram/balancer";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_req: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const stored = getStoredGeneration(jobId);

  if (stored?.status === "completed") {
    await registerImageGenerationFinish(jobId);
    return Response.json({
      jobId: stored.jobId,
      status: stored.status,
      images: stored.images,
    });
  }

  if (stored?.status === "failed") {
    await registerImageGenerationFinish(jobId);
    return Response.json({
      jobId: stored.jobId,
      status: stored.status,
      error: stored.error ?? "Generation failed",
    });
  }

  if (stored?.status === "queued" || stored?.status === "running") {
    await registerImageGenerationStart(jobId);
  }

  try {
    const result = await getWorkflowStatus(await getClient(), jobId);

    if (result.status === ComfyJobStatus.Completed) {
      await registerImageGenerationFinish(jobId);
      return Response.json({
        jobId: result.jobId,
        status: result.status,
        images: result.images,
      });
    }

    if (result.status === ComfyJobStatus.Failed) {
      markGenerationFailed(jobId, "Generation failed");
      await registerImageGenerationFinish(jobId);
      return Response.json(
        {
          jobId,
          status: result.status,
          error: "Generation failed",
        },
        { status: 200 },
      );
    }

    await registerImageGenerationStart(jobId);

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
      await registerImageGenerationFinish(jobId);
      return Response.json({
        jobId,
        status: "failed",
        error: message,
      });
    }

    await registerImageGenerationFinish(jobId);

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
