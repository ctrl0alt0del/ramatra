"use client";

import { useCallback, useMemo, useRef } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { type PromptMode } from "@/lib/lmstudio/prompt-modes";

import { ChatLayout } from "./chat/ChatLayout";
import {
  PromptModeProvider,
  usePromptMode,
} from "./chat/prompt-mode";
import { MoodProvider, useMood } from "./chat/mood";
import { usePersistedRuntime } from "./chat/runtime";
import { ThreadEventsProvider } from "./chat/thread-events";

function ChatShell() {
  const { mode, setMode } = usePromptMode();
  const { moodId, setMoodId } = useMood();
  const modeRef = useRef(mode);
  const moodIdRef = useRef(moodId);

  modeRef.current = mode;
  moodIdRef.current = moodId;

  const applyThreadSettings = useCallback(
    ({
      promptMode,
      moodId: threadMoodId,
    }: {
      promptMode: PromptMode | null;
      moodId: string | null;
    }) => {
      if (promptMode && promptMode !== modeRef.current) {
        setMode(promptMode);
      }

      if (threadMoodId !== moodIdRef.current) {
        setMoodId(threadMoodId);
      }
    },
    [setMode, setMoodId],
  );

  const runtimeOptions = useMemo(
    () => ({
      onThreadSettingsLoaded: applyThreadSettings,
    }),
    [applyThreadSettings],
  );

  const runtime = usePersistedRuntime(mode, moodId, runtimeOptions);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadEventsProvider>
        <ChatLayout />
      </ThreadEventsProvider>
    </AssistantRuntimeProvider>
  );
}

export function Chat() {
  return (
    <PromptModeProvider>
      <MoodProvider>
        <ChatShell />
      </MoodProvider>
    </PromptModeProvider>
  );
}

