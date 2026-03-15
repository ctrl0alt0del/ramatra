"use client";

import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, Heart, Sparkles } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useThread } from "@assistant-ui/react";

export type MoodOption = {
  id: string;
  label: string;
  prompt: string;
};

type MoodContextValue = {
  moodId: string | null;
  setMoodId: (moodId: string | null) => void;
  moods: MoodOption[];
  refreshMoods: () => Promise<void>;
};

const STORAGE_KEY = "comfy-bridge-mood-id";
export const MOODS_UPDATED_EVENT = "comfy-bridge-moods-updated";
const NONE_VALUE = "__none__";

const MoodContext = createContext<MoodContextValue>({
  moodId: null,
  setMoodId: () => {},
  moods: [],
  refreshMoods: async () => {},
});

const isKnownMood = (moods: MoodOption[], moodId: string | null) => {
  if (!moodId) {
    return true;
  }

  return moods.some((mood) => mood.id === moodId);
};

export function MoodProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [moods, setMoods] = useState<MoodOption[]>([]);
  const [moodId, setMoodIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }

    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored?.trim() ? stored : null;
  });

  const refreshMoods = async () => {
    const response = await fetch("/api/settings/moods", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Failed to load moods.");
    }

    const data = (await response.json()) as {
      moods: Array<{ id: string; label: string; prompt: string }>;
    };

    const nextMoods = data.moods
      .map((mood) => ({
        id: mood.id,
        label: mood.label,
        prompt: mood.prompt,
      }))
      .filter((mood) => mood.id.trim().length > 0 && mood.label.trim().length > 0);

    setMoods(nextMoods);
    setMoodIdState((previousMoodId) =>
      isKnownMood(nextMoods, previousMoodId) ? previousMoodId : null,
    );
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        await refreshMoods();
      } catch {
        if (!cancelled) {
          setMoods([]);
          setMoodIdState(null);
        }
      }
    };

    void load();

    const handleMoodsUpdated = () => {
      void load();
    };

    window.addEventListener(MOODS_UPDATED_EVENT, handleMoodsUpdated);

    return () => {
      cancelled = true;
      window.removeEventListener(MOODS_UPDATED_EVENT, handleMoodsUpdated);
    };
  }, []);

  useEffect(() => {
    if (moodId) {
      window.localStorage.setItem(STORAGE_KEY, moodId);
      return;
    }

    window.localStorage.removeItem(STORAGE_KEY);
  }, [moodId]);

  const setMoodId = (nextMoodId: string | null) => {
    setMoodIdState(nextMoodId);
  };

  const value = useMemo(
    () => ({
      moodId,
      setMoodId,
      moods,
      refreshMoods,
    }),
    [moodId, moods],
  );

  return <MoodContext.Provider value={value}>{children}</MoodContext.Provider>;
}

export const useMood = () => useContext(MoodContext);

export function MoodSelect() {
  const { moodId, setMoodId, moods } = useMood();
  const hasAssistantResponse = useThread((state) =>
    state.messages.some((message) => message.role === "assistant"),
  );
  const isThreadRunning = useThread((state) => state.isRunning);
  const isLocked = hasAssistantResponse || isThreadRunning;
  const selectedValue = moodId ?? NONE_VALUE;

  return (
    <div className="flex items-stretch">
      <Select.Root
        disabled={isLocked}
        value={selectedValue}
        onValueChange={(nextValue) => {
          if (nextValue === NONE_VALUE) {
            setMoodId(null);
            return;
          }

          if (moods.some((mood) => mood.id === nextValue)) {
            setMoodId(nextValue);
          }
        }}
      >
        <Select.Trigger
          className="inline-flex h-12 w-full items-center justify-between gap-3 rounded-[18px] border border-white/70 bg-white/84 text-sm font-medium text-[hsl(var(--aui-foreground))] shadow-[0_12px_28px_rgba(73,56,145,0.08)] outline-none transition hover:bg-white focus:border-[hsl(var(--aui-ring))] disabled:cursor-not-allowed disabled:opacity-65 sm:h-14 sm:min-w-56 sm:rounded-[20px]"
          style={{ paddingLeft: "1.25rem", paddingRight: "1.25rem" }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-2xl bg-[#ffeef4] text-[#cc507a] sm:h-9 sm:w-9">
              <Heart className="h-4 w-4" />
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
              <MoodOptionItem id={NONE_VALUE} label="No Mood" description="Mode-only behavior" />
              {moods.map((mood) => (
                <MoodOptionItem
                  key={mood.id}
                  id={mood.id}
                  label={mood.label}
                  description="Custom mood overlay"
                />
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

function MoodOptionItem({
  id,
  label,
  description,
}: Readonly<{
  id: string;
  label: string;
  description: string;
}>) {
  return (
    <Select.Item
      value={id}
      className="relative flex cursor-pointer select-none items-center gap-3 rounded-[20px] px-3 py-3 text-sm font-medium text-[hsl(var(--aui-foreground))] outline-none transition data-[highlighted]:bg-white/80"
    >
      <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#ffeef4] text-[#cc507a]">
        <Sparkles className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <Select.ItemText>{label}</Select.ItemText>
          <Select.ItemIndicator className="inline-flex items-center text-[hsl(var(--aui-foreground))]">
            <Check className="h-4 w-4" />
          </Select.ItemIndicator>
        </div>
        <p className="mt-0.5 text-xs font-normal text-[hsl(var(--aui-muted-foreground))]">
          {description}
        </p>
      </div>
    </Select.Item>
  );
}
