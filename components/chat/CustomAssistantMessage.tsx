"use client";

import { useMessage } from "@assistant-ui/react";
import { AssistantActionBar, AssistantMessage, BranchPicker } from "@assistant-ui/react-ui";
import { parseContextCompactionDuringRequestMarker } from "@/lib/chat/context-compaction-marker";

import { AssistantReasoning } from "./AssistantReasoning";
import { AssistantText } from "./AssistantText";
import { ContextCompactionInline } from "./ContextCompactionInline";

export function CustomAssistantMessage() {
  const markerCount = useMessage((state) => {
    const content = state.content;
    if (!Array.isArray(content)) {
      return null;
    }

    const text = content
      .flatMap((part) =>
        part.type === "text" && typeof part.text === "string" ? [part.text] : [],
      )
      .join("\n")
      .trim();

    if (!text) {
      return null;
    }

    return parseContextCompactionDuringRequestMarker(text);
  });

  if (markerCount !== null) {
    return <ContextCompactionInline text={`Context compacted during response (${markerCount})`} />;
  }

  return (
    <AssistantMessage.Root>
      <AssistantMessage.Avatar />
      <AssistantMessage.Content
        components={{
          Reasoning: AssistantReasoning,
          Text: AssistantText,
        }}
      />
      <BranchPicker />
      <AssistantActionBar />
    </AssistantMessage.Root>
  );
}
