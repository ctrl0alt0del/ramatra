import { getSystemMonitorSnapshot } from "@/lib/system/monitor";
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
      let inFlight = false;
      let pending = false;
      let lastPayload = "";

      const emitSnapshot = async () => {
        if (closed) {
          return;
        }

        if (inFlight) {
          pending = true;
          return;
        }

        inFlight = true;

        try {
          const snapshot = await getSystemMonitorSnapshot();
          const serialized = JSON.stringify(snapshot);

          if (!closed && serialized !== lastPayload) {
            lastPayload = serialized;
            controller.enqueue(formatSseMessage("monitor", snapshot));
          }
        } catch {
          // Keep stream alive and retry on next event/tick.
        } finally {
          inFlight = false;

          if (pending) {
            pending = false;
            void emitSnapshot();
          }
        }
      };

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        clearInterval(pollId);
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
        subscribeToTaskEvent("queue:changed", () => {
          void emitSnapshot();
        }),
        subscribeToTaskEvent("gpu:changed", () => {
          void emitSnapshot();
        }),
        subscribeToTaskEvent("task:updated", () => {
          void emitSnapshot();
        }),
        subscribeToTaskEvent("task:completed", () => {
          void emitSnapshot();
        }),
        subscribeToTaskEvent("task:failed", () => {
          void emitSnapshot();
        }),
      ];

      const pollId = setInterval(() => {
        void emitSnapshot();
      }, 5000);

      const keepAliveId = setInterval(() => {
        if (!closed) {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        }
      }, 15000);

      req.signal.addEventListener("abort", close, { once: true });
      void emitSnapshot();
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

