"use client";

import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, Image, Pencil, Sparkles, Users, Zap } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useThread } from "@assistant-ui/react";

import {
  defaultPromptMode,
  isPromptMode,
  promptModeDescriptions,
  promptModeLabels,
  promptModes,
  type PromptMode,
} from "@/lib/lmstudio/prompt-modes";

type PromptModeContextValue = {
  mode: PromptMode;
  setMode: (mode: PromptMode) => void;
};

const PromptModeContext = createContext<PromptModeContextValue>({
  mode: defaultPromptMode,
  setMode: () => {},
});

const STORAGE_KEY = "comfy-bridge-prompt-mode";

const promptModeIcons: Record<PromptMode, typeof Zap> = {
  fast: Zap,
  regular: Sparkles,
  writer: Pencil,
  roleplay: Users,
  artist: Image,
};

export function PromptModeProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [mode, setMode] = useState<PromptMode>(() => {
    if (typeof window === "undefined") {
      return defaultPromptMode;
    }

    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored && isPromptMode(stored) ? stored : defaultPromptMode;
  });

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const value = useMemo(() => ({ mode, setMode }), [mode]);

  return (
    <PromptModeContext.Provider value={value}>
      {children}
    </PromptModeContext.Provider>
  );
}

export const usePromptMode = () => useContext(PromptModeContext);

export function PromptModeSelect() {
  const { mode, setMode } = usePromptMode();
  const hasAssistantResponse = useThread((state) =>
    state.messages.some((message) => message.role === "assistant"),
  );
  const isThreadRunning = useThread((state) => state.isRunning);
  const isLocked = hasAssistantResponse || isThreadRunning;
  const SelectedIcon = promptModeIcons[mode];

  return (
    <div className="flex items-stretch">
      <Select.Root
        disabled={isLocked}
        value={mode}
        onValueChange={(nextMode) => {
          if (isPromptMode(nextMode)) {
            setMode(nextMode);
          }
        }}
      >
        <Select.Trigger
          className="inline-flex h-12 w-full items-center justify-between gap-3 rounded-[18px] border border-white/70 bg-white/84 text-sm font-medium text-[hsl(var(--aui-foreground))] shadow-[0_12px_28px_rgba(73,56,145,0.08)] outline-none transition hover:bg-white focus:border-[hsl(var(--aui-ring))] disabled:cursor-not-allowed disabled:opacity-65 sm:h-14 sm:min-w-56 sm:rounded-[20px]"
          style={{ paddingLeft: "1.25rem", paddingRight: "1.25rem" }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-2xl bg-[#f1ecff] text-[#7267f3] sm:h-9 sm:w-9">
              <SelectedIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0 text-left">
              <Select.Value />
            </div>
          </div>
          <Select.Icon className="translate-x-0 text-[hsl(var(--aui-muted-foreground))]">
            <ChevronDown className="h-4 w-4" />
          </Select.Icon>
        </Select.Trigger>

        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={8}
            className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[24px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(245,240,255,0.96)_100%)] p-1.5 shadow-[0_24px_60px_rgba(37,28,86,0.2)]"
          >
            <Select.Viewport className="p-0.5">
              {promptModes.map((promptMode) => (
                <PromptModeOption key={promptMode} promptMode={promptMode} />
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

function PromptModeOption({
  promptMode,
}: Readonly<{
  promptMode: PromptMode;
}>) {
  const Icon = promptModeIcons[promptMode];

  return (
    <Select.Item
      value={promptMode}
      className="relative flex cursor-pointer select-none items-center gap-3 rounded-[20px] px-3 py-3 text-sm font-medium text-[hsl(var(--aui-foreground))] outline-none transition data-[highlighted]:bg-white/80"
    >
      <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#f1ecff] text-[#7267f3]">
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <Select.ItemText>{promptModeLabels[promptMode]}</Select.ItemText>
          <Select.ItemIndicator className="inline-flex items-center text-[hsl(var(--aui-foreground))]">
            <Check className="h-4 w-4" />
          </Select.ItemIndicator>
        </div>
        <p className="mt-0.5 text-xs font-normal text-[hsl(var(--aui-muted-foreground))]">
          {promptModeDescriptions[promptMode]}
        </p>
      </div>
    </Select.Item>
  );
}


