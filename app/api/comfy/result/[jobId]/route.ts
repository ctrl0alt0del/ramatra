import { getClient } from "@/lib/comfy/client";
import { ComfyJobStatus, getWorkflowStatus } from "@/lib/comfy/runner";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_req: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const result = await getWorkflowStatus(await getClient(), jobId);

  if (result.status === ComfyJobStatus.Completed) {
    return Response.json({
      jobId: result.jobId,
      status: result.status,
      images: result.images,
    });
  }

  if (result.status === ComfyJobStatus.Failed) {
    return Response.json(
      {
        jobId,
        status: result.status,
        error: "Generation failed",
      },
      { status: 200 },
    );
  }

  return Response.json({
    jobId: result.jobId,
    status: result.status,
  });
}
