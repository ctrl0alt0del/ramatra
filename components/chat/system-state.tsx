"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type SystemState = {
  phase: "chat_ready" | "switching_to_image" | "image_running" | "restoring_chat";
  canChat: boolean;
  activeGenerationCount: number;
  message: string;
  lastError: string | null;
};

type SystemStateContextValue = {
  state: SystemState;
  refresh: () => Promise<void>;
};

const defaultState: SystemState = {
  phase: "chat_ready",
  canChat: true,
  activeGenerationCount: 0,
  message: "Chat model ready.",
  lastError: null,
};

const SystemStateContext = createContext<SystemStateContextValue>({
  state: defaultState,
  refresh: async () => {},
});

export function SystemStateProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [state, setState] = useState<SystemState>(defaultState);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/system/state", {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error("Failed to fetch system state");
    }

    const data = (await response.json()) as SystemState;
    setState(data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let reconnectId: number | null = null;
    let source: EventSource | null = null;

    const connect = () => {
      if (cancelled) {
        return;
      }

      source = new EventSource("/api/system/state/events");
      source.addEventListener("state", (event: MessageEvent<string>) => {
        if (cancelled) {
          return;
        }

        const data = JSON.parse(event.data) as SystemState;
        setState(data);
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

  const value = useMemo(() => ({ state, refresh }), [state, refresh]);
  return (
    <SystemStateContext.Provider value={value}>
      {children}
    </SystemStateContext.Provider>
  );
}

export const useSystemState = () => useContext(SystemStateContext);
