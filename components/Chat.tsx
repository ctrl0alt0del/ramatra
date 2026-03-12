"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";

import { ChatLayout } from "./chat/ChatLayout";
import {
  PromptModeProvider,
  usePromptMode,
} from "./chat/prompt-mode";
import { usePersistedRuntime } from "./chat/runtime";
import { ThreadEventsProvider } from "./chat/thread-events";

function ChatShell() {
  const { mode } = usePromptMode();
  const runtime = usePersistedRuntime(mode);

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
      <ChatShell />
    </PromptModeProvider>
  );
}
