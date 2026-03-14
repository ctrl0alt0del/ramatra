import { getChatTaskViewByStreamTaskId } from "@/lib/tasks/chat-task-view";
import { subscribeToTaskEvent } from "@/lib/tasks/event-bus";
import { processTaskQueues } from "@/lib/tasks/processor";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ taskId: string }>;
};

const encoder = new TextEncoder();

const formatSseMessage = (event: string, data: unknown) => {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

export async function GET(_req: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const initialView = getChatTaskViewByStreamTaskId(taskId);

  if (!initialView) {
    return Response.json(
      {
        taskId,
        status: "failed",
        error: "Chat task not found.",
      },
      { status: 404 },
    );
  }

  if (initialView.status === "queued") {
    void processTaskQueues();
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(formatSseMessage("task", initialView));

      const emitCurrentView = () => {
        const view = getChatTaskViewByStreamTaskId(taskId);
        if (!view) return;

        controller.enqueue(formatSseMessage("task", view));

        if (view.status === "completed" || view.status === "failed") {
          cleanup();
          controller.close();
        }
      };

      const unsubscribers = [
        subscribeToTaskEvent("task:queued", () => emitCurrentView()),
        subscribeToTaskEvent("task:started", () => emitCurrentView()),
        subscribeToTaskEvent("task:updated", () => emitCurrentView()),
        subscribeToTaskEvent("task:completed", () => emitCurrentView()),
        subscribeToTaskEvent("task:failed", () => emitCurrentView()),
        subscribeToTaskEvent("task:cancelled", () => emitCurrentView()),
      ];

      const keepAliveId = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 15000);

      const cleanup = () => {
        clearInterval(keepAliveId);
        for (const unsubscribe of unsubscribers) {
          unsubscribe();
        }
      };

      if (initialView.status === "completed" || initialView.status === "failed") {
        cleanup();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
