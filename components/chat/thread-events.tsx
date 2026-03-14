"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ThreadApiSummary } from "./types";

type ThreadsEventPayload = {
  threads: ThreadApiSummary[];
};

export type ThreadCompactionNotice = {
  at: number;
  kind: "in_request" | "between_messages";
  delta: number;
};

type ThreadEventsContextValue = {
  byId: Record<string, ThreadApiSummary>;
  compactionById: Record<string, ThreadCompactionNotice>;
};

const ThreadEventsContext = createContext<ThreadEventsContextValue>({
  byId: {},
  compactionById: {},
});

const getThreadSummarySignature = (threads: ThreadApiSummary[]) =>
  JSON.stringify(
    threads.map((thread) => [
      thread.id,
      thread.title,
      thread.titleGenerated,
      thread.status,
      thread.summaryCallCountTotal,
      thread.summaryCallsInCurrentRequest,
      thread.contextWindowUsedTokens,
      thread.contextWindowTotalTokens,
    ]),
  );

export function ThreadEventsProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [state, setState] = useState<ThreadEventsContextValue>({
    byId: {},
    compactionById: {},
  });
  const lastSignatureRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    let reconnectId: number | null = null;
    let source: EventSource | null = null;

    const connect = () => {
      if (cancelled) {
        return;
      }

      source = new EventSource("/api/threads/events");
      source.addEventListener("threads", (event: MessageEvent<string>) => {
        if (cancelled) {
          return;
        }

        const payload = JSON.parse(event.data) as ThreadsEventPayload;
        const signature = getThreadSummarySignature(payload.threads);
        if (signature === lastSignatureRef.current) {
          return;
        }

        lastSignatureRef.current = signature;

        setState((previous) => {
          const nextById: Record<string, ThreadApiSummary> = {};
          const nextCompactionById = { ...previous.compactionById };

          for (const thread of payload.threads) {
            nextById[thread.id] = thread;

            const previousThread = previous.byId[thread.id];
            const previousCount = previousThread?.summaryCallCountTotal ?? 0;
            const delta = thread.summaryCallCountTotal - previousCount;

            if (delta > 0) {
              nextCompactionById[thread.id] = {
                at: Date.now(),
                kind:
                  thread.summaryCallsInCurrentRequest > 0
                    ? "in_request"
                    : "between_messages",
                delta,
              };
            }
          }

          for (const threadId of Object.keys(nextCompactionById)) {
            if (!nextById[threadId]) {
              delete nextCompactionById[threadId];
            }
          }

          return {
            byId: nextById,
            compactionById: nextCompactionById,
          };
        });
      });

      source.onerror = () => {
        source?.close();
        source = null;

        if (cancelled) {
          return;
        }

        reconnectId = window.setTimeout(connect, 1000);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectId !== null) {
        window.clearTimeout(reconnectId);
      }
      source?.close();
    };
  }, []);

  const value = useMemo(() => state, [state]);
  return (
    <ThreadEventsContext.Provider value={value}>
      {children}
    </ThreadEventsContext.Provider>
  );
}

export const useThreadEvents = () => useContext(ThreadEventsContext);
