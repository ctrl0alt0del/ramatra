import { getComfyTaskView } from "@/lib/tasks/comfy-task-view";
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

export async function GET(req: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const initialView = getComfyTaskView(taskId);

  if (!initialView) {
    return Response.json(
      {
        taskId,
        status: "failed",
        error: "Comfy task not found.",
      },
      { status: 404 },
    );
  }

  if (initialView.status === "queued") {
    void processTaskQueues();
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const unsubscribers: Array<() => void> = [];
      let keepAliveId: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (keepAliveId) {
          clearInterval(keepAliveId);
          keepAliveId = null;
        }

        for (const unsubscribe of unsubscribers) {
          unsubscribe();
        }
        unsubscribers.length = 0;
      };

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        cleanup();

        try {
          controller.close();
        } catch {
          // Stream may already be closed.
        }
      };

      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) {
          return false;
        }

        try {
          controller.enqueue(chunk);
          return true;
        } catch {
          close();
          return false;
        }
      };

      const emitCurrentView = () => {
        const view = getComfyTaskView(taskId);
        if (!view) {
          return;
        }

        if (!safeEnqueue(formatSseMessage("task", view))) {
          return;
        }

        if (view.status === "completed" || view.status === "failed") {
          close();
        }
      };

      safeEnqueue(formatSseMessage("task", initialView));

      unsubscribers.push(
        subscribeToTaskEvent("task:queued", ({ task }) => {
          if (task.id === taskId) {
            emitCurrentView();
          }
        }),
      );
      unsubscribers.push(
        subscribeToTaskEvent("task:started", ({ task }) => {
          if (task.id === taskId) {
            emitCurrentView();
          }
        }),
      );
      unsubscribers.push(
        subscribeToTaskEvent("task:updated", ({ task }) => {
          if (task.id === taskId) {
            emitCurrentView();
          }
        }),
      );
      unsubscribers.push(
        subscribeToTaskEvent("task:completed", ({ task }) => {
          if (task.id === taskId) {
            emitCurrentView();
          }
        }),
      );
      unsubscribers.push(
        subscribeToTaskEvent("task:failed", ({ task }) => {
          if (task.id === taskId) {
            emitCurrentView();
          }
        }),
      );
      unsubscribers.push(
        subscribeToTaskEvent("task:cancelled", ({ task }) => {
          if (task.id === taskId) {
            emitCurrentView();
          }
        }),
      );

      keepAliveId = setInterval(() => {
        safeEnqueue(encoder.encode(": keepalive\n\n"));
      }, 15000);

      req.signal.addEventListener("abort", close, { once: true });

      if (initialView.status === "completed" || initialView.status === "failed") {
        close();
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
