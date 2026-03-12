import { getComfyTaskView } from "@/lib/tasks/comfy-task-view";
import { processTaskQueues } from "@/lib/tasks/processor";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ taskId: string }>;
};

export async function GET(_req: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const view = getComfyTaskView(taskId);
  if (!view) {
    return Response.json(
      {
        taskId,
        status: "failed",
        error: "Comfy task not found.",
      },
      { status: 404 },
    );
  }

  if (view.status === "queued") {
    void processTaskQueues();
  }

  return Response.json(view);
}
