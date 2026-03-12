import { getComfyTaskView } from "@/lib/tasks/comfy-task-view";

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
  return Response.json(view);
}
