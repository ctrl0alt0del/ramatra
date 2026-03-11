"use client";

import * as Select from "@radix-ui/react-select";
import {
  Check,
  ChevronDown,
  Compass,
  Image,
  Pencil,
  Sparkles,
  Zap,
} from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

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
  const SelectedIcon = promptModeIcons[mode];

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-[0.14em] text-[hsl(var(--aui-muted-foreground))]">
        Mode
      </span>
      <Select.Root
        value={mode}
        onValueChange={(nextMode) => {
          if (isPromptMode(nextMode)) {
            setMode(nextMode);
          }
        }}
      >
        <Select.Trigger className="inline-flex h-11 min-w-48 items-center justify-between gap-3 rounded-full border border-[hsl(var(--aui-border))] bg-[hsl(var(--aui-background))] pl-3 pr-4 text-sm font-medium text-[hsl(var(--aui-foreground))] shadow-sm outline-none transition hover:bg-[hsl(var(--aui-muted))] focus:border-[hsl(var(--aui-ring))]">
          <div className="flex min-w-0 items-center gap-3">
            <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--aui-muted))] text-[hsl(var(--aui-foreground))]">
              <SelectedIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0 text-left">
              <p className="truncate text-[11px] uppercase tracking-[0.14em] text-[hsl(var(--aui-muted-foreground))]">
                Assistant
              </p>
              <Select.Value />
            </div>
          </div>
          <Select.Icon className="text-[hsl(var(--aui-muted-foreground))]">
            <ChevronDown className="h-4 w-4" />
          </Select.Icon>
        </Select.Trigger>

        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={8}
            className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-2xl border border-[hsl(var(--aui-border))] bg-[hsl(var(--aui-background))] p-1 shadow-2xl"
          >
            <Select.Viewport className="p-1">
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
      className="relative flex cursor-pointer select-none items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium text-[hsl(var(--aui-foreground))] outline-none transition data-[highlighted]:bg-[hsl(var(--aui-muted))]"
    >
      <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--aui-muted))] text-[hsl(var(--aui-foreground))]">
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
