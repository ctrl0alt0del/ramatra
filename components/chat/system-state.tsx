"use client";

import {
  createContext,
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

const defaultState: SystemState = {
  phase: "chat_ready",
  canChat: true,
  activeGenerationCount: 0,
  message: "Chat model ready.",
  lastError: null,
};

const SystemStateContext = createContext<SystemState>(defaultState);

export function SystemStateProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [state, setState] = useState<SystemState>(defaultState);

  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      try {
        const response = await fetch("/api/system/state", {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Failed to fetch system state");
        }

        const data = (await response.json()) as SystemState;
        if (!cancelled) {
          setState(data);
        }
      } catch {
        if (!cancelled) {
          setState((previous) => previous);
        }
      }
    };

    void sync();
    const intervalId = window.setInterval(sync, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const value = useMemo(() => state, [state]);
  return (
    <SystemStateContext.Provider value={value}>
      {children}
    </SystemStateContext.Provider>
  );
}

export const useSystemState = () => useContext(SystemStateContext);
