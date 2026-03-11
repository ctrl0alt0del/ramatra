"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";

import { ChatLayout } from "./chat/ChatLayout";
import {
  PromptModeProvider,
  usePromptMode,
} from "./chat/prompt-mode";
import { usePersistedRuntime } from "./chat/runtime";

function ChatShell() {
  const { mode } = usePromptMode();
  const runtime = usePersistedRuntime(mode);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatLayout />
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
