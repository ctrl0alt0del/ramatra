"use client";

import {
  AssistantActionBar,
  AssistantMessage,
  BranchPicker,
} from "@assistant-ui/react-ui";

import { AssistantReasoning } from "./AssistantReasoning";
import { AssistantText } from "./AssistantText";

export function CustomAssistantMessage() {
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
