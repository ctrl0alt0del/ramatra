"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";

import { ChatLayout } from "./chat/ChatLayout";
import {
  PromptModeProvider,
  usePromptMode,
} from "./chat/prompt-mode";
import { MoodProvider, useMood } from "./chat/mood";
import { usePersistedRuntime } from "./chat/runtime";
import { ThreadEventsProvider } from "./chat/thread-events";

function ChatShell() {
  const { mode } = usePromptMode();
  const { moodId } = useMood();
  const runtime = usePersistedRuntime(mode, moodId);

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

