"use client";

import { MessagePrimitive, useMessage } from "@assistant-ui/react";
import {
  BranchPicker,
  UserActionBar,
  UserMessage,
} from "@assistant-ui/react-ui";

import { parseCritiqueRequestMarker } from "@/lib/chat/critique-marker";

export function CustomUserMessage() {
  const isCritiqueMarkerMessage = useMessage((state) => {
    const text = state.content
      .flatMap((part) =>
        part.type === "text" && typeof part.text === "string"
          ? [part.text]
          : [],
      )
      .join("\n")
      .trim();

    return Boolean(text && parseCritiqueRequestMarker(text));
  });

  if (isCritiqueMarkerMessage) {
    return null;
  }

  return (
    <UserMessage.Root className="w-full max-w-[var(--aui-thread-max-width)] py-4">
      <UserMessage.Attachments />
      <MessagePrimitive.If hasContent>
        <div className="ml-auto grid w-full max-w-full grid-cols-[auto_minmax(0,var(--aui-bubble-inline-size))] items-start justify-end gap-3">
          <UserActionBar />
          <UserMessage.Content />
        </div>
      </MessagePrimitive.If>
      <BranchPicker />
    </UserMessage.Root>
  );
}
