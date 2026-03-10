"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";

import { ChatLayout } from "./chat/ChatLayout";
import { usePersistedRuntime } from "./chat/runtime";

export function Chat() {
  const runtime = usePersistedRuntime();

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatLayout />
    </AssistantRuntimeProvider>
  );
}
