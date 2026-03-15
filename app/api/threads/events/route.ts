import { listThreads } from "@/lib/lmstudio/threads";
import { subscribeToThreadEvents } from "@/lib/threads/event-bus";

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

      const emitThreads = (change?: {
        type: "created" | "updated" | "deleted";
        threadId: string;
        emittedAt: string;
      }) => {
        if (closed) {
          return;
        }

        const payload = {
          change: change ?? null,
          threads: listThreads(),
          emittedAt: new Date().toISOString(),
        };
        const serialized = JSON.stringify(payload);

        if (serialized === lastPayload) {
          return;
        }

        lastPayload = serialized;

        try {
          controller.enqueue(formatSseMessage("threads", payload));
        } catch {
          close();
        }
      };

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        clearInterval(keepAliveId);
        unsubscribe();

        try {
          controller.close();
        } catch {
          // Stream may already be closed.
        }
      };

      const unsubscribe = subscribeToThreadEvents((event) => {
        emitThreads({
          type: event.change,
          threadId: event.threadId,
          emittedAt: event.emittedAt,
        });
      });

      const keepAliveId = setInterval(() => {
        if (closed) {
          return;
        }

        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          close();
        }
      }, 15000);

      req.signal.addEventListener("abort", close, { once: true });
      emitThreads();
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

