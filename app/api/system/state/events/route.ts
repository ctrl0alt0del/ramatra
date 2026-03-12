import { getSchedulerSystemState } from "@/lib/tasks/gpu-manager";
import { subscribeToTaskEvent } from "@/lib/tasks/event-bus";

export const runtime = "nodejs";

const encoder = new TextEncoder();

const formatSseMessage = (event: string, data: unknown) => {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

export async function GET(req: Request) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let lastPayload = "";

      const emitState = () => {
        if (closed) {
          return;
        }

        const state = getSchedulerSystemState();
        const serialized = JSON.stringify(state);

        if (serialized === lastPayload) {
          return;
        }

        lastPayload = serialized;
        controller.enqueue(formatSseMessage("state", state));
      };

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        clearInterval(keepAliveId);
        for (const unsubscribe of unsubscribers) {
          unsubscribe();
        }

        try {
          controller.close();
        } catch {
          // Stream may already be closed.
        }
      };

      const unsubscribers = [
        subscribeToTaskEvent("queue:changed", () => emitState()),
        subscribeToTaskEvent("gpu:changed", () => emitState()),
        subscribeToTaskEvent("task:updated", () => emitState()),
        subscribeToTaskEvent("task:completed", () => emitState()),
        subscribeToTaskEvent("task:failed", () => emitState()),
      ];

      const keepAliveId = setInterval(() => {
        if (!closed) {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        }
      }, 15000);

      req.signal.addEventListener("abort", close, { once: true });
      emitState();
    },
    cancel() {
      // cleanup handled via abort signal
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
