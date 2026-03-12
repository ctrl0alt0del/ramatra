"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { ThreadApiSummary } from "./types";

type ThreadsEventPayload = {
  threads: ThreadApiSummary[];
};

type ThreadEventsContextValue = {
  byId: Record<string, ThreadApiSummary>;
};

const ThreadEventsContext = createContext<ThreadEventsContextValue>({
  byId: {},
});

export function ThreadEventsProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [byId, setById] = useState<Record<string, ThreadApiSummary>>({});

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
        const nextById: Record<string, ThreadApiSummary> = {};

        for (const thread of payload.threads) {
          nextById[thread.id] = thread;
        }

        setById(nextById);
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

  const value = useMemo(() => ({ byId }), [byId]);
  return (
    <ThreadEventsContext.Provider value={value}>
      {children}
    </ThreadEventsContext.Provider>
  );
}

export const useThreadEvents = () => useContext(ThreadEventsContext);
