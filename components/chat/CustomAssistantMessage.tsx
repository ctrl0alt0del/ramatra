"use client";

import { MessagePrimitive, TextMessagePartProvider, useMessage } from "@assistant-ui/react";
import {
  AssistantActionBar,
  AssistantMessage,
  BranchPicker,
  makeMarkdownText,
} from "@assistant-ui/react-ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { parseContextCompactionDuringRequestMarker } from "@/lib/chat/context-compaction-marker";
import {
  getMessageReasoning,
  subscribeToMessageReasoning,
} from "@/lib/state/reasoning-stream-repository";

import { AssistantText } from "./AssistantText";
import { ContextCompactionInline } from "./ContextCompactionInline";

const NullReasoningPart = () => null;

const ReasoningMarkdown = makeMarkdownText({
  remarkPlugins: [remarkGfm, remarkMath],
  rehypePlugins: [rehypeKatex],
  preprocess(text) {
    return text
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");
  },
});

function AssistantReasoningOutside() {
  const [open, setOpen] = useState(false);
  const [displayReasoning, setDisplayReasoning] = useState("");

  const messageId = useMessage((state) =>
    typeof state.id === "string" && state.id.trim().length > 0
      ? state.id.trim()
      : null,
  );

  const dbMessageId = useMessage((state) => {
    const metadata =
      state.metadata && typeof state.metadata === "object"
        ? (state.metadata as Record<string, unknown>)
        : {};
    const custom =
      metadata.custom && typeof metadata.custom === "object"
        ? (metadata.custom as Record<string, unknown>)
        : {};

    return typeof custom.dbMessageId === "string" && custom.dbMessageId.trim().length > 0
      ? custom.dbMessageId.trim()
      : null;
  });

  const fallbackReasoning = useMessage((state) => {
    const metadata =
      state.metadata && typeof state.metadata === "object"
        ? (state.metadata as Record<string, unknown>)
        : {};
    const custom =
      metadata.custom && typeof metadata.custom === "object"
        ? (metadata.custom as Record<string, unknown>)
        : {};

    const transientReasoning =
      typeof custom.transientReasoning === "string"
        ? custom.transientReasoning.trim()
        : "";
    if (transientReasoning) {
      return transientReasoning;
    }

    const content = state.content;
    if (!Array.isArray(content)) {
      return "";
    }

    return content
      .flatMap((part) =>
        part.type === "reasoning" && typeof part.text === "string"
          ? [part.text]
          : [],
      )
      .join("\n\n")
      .trim();
  });

  const cachedReasoning = getMessageReasoning({
    messageId,
    dbMessageId,
  });

  useEffect(() => {
    if (!open) {
      setDisplayReasoning("");
      return;
    }

    const currentReasoning =
      getMessageReasoning({
        messageId,
        dbMessageId,
      }) || fallbackReasoning;
    setDisplayReasoning(currentReasoning);

    return subscribeToMessageReasoning(
      {
        messageId,
        dbMessageId,
      },
      (reasoning) => {
        setDisplayReasoning((previous) =>
          previous === reasoning ? previous : reasoning,
        );
      },
    );
  }, [dbMessageId, fallbackReasoning, messageId, open]);

  const reasoningText = open
    ? displayReasoning
    : cachedReasoning || fallbackReasoning;

  if (!reasoningText) {
    return null;
  }

  return (
    <div className="mb-1 rounded-xl px-1 py-0.5">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5"
        style={{ fontSize: "12px", lineHeight: "16px", color: "#8d8aa3", fontWeight: 500 }}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-[#9a98ad]" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-[#9a98ad]" />
        )}
        <span>Thinking</span>
      </button>
      {open ? (
        <div
          className="mt-1.5"
          style={{ fontSize: "12px", lineHeight: "20px", color: "#8d8aa3" }}
        >
          <TextMessagePartProvider text={reasoningText} isRunning={false}>
            <ReasoningMarkdown />
          </TextMessagePartProvider>
        </div>
      ) : null}
    </div>
  );
}

export function CustomAssistantMessage() {
  const isRunning = useMessage((state) => state.status?.type === "running");
  const hasTextContent = useMessage((state) => {
    const content = state.content;
    if (!Array.isArray(content)) {
      return false;
    }

    return content.some(
      (part) =>
        part.type === "text" &&
        typeof part.text === "string" &&
        part.text.trim().length > 0,
    );
  });

  const markerCount = useMessage((state) => {
    const content = state.content;
    if (!Array.isArray(content)) {
      return null;
    }

    const text = content
      .flatMap((part) =>
        part.type === "text" && typeof part.text === "string"
          ? [part.text]
          : [],
      )
      .join("\n")
      .trim();

    if (!text) {
      return null;
    }

    return parseContextCompactionDuringRequestMarker(text);
  });

  if (markerCount !== null) {
    return (
      <ContextCompactionInline
        text={`Context compacted during response (${markerCount})`}
      />
    );
  }

  return (
    <AssistantMessage.Root>
      <AssistantMessage.Avatar />
      <MessagePrimitive.If hasContent={false}>
        {isRunning ? (
          <div className="flex items-center gap-1.5 px-1 py-2">
            <span className="h-2 w-2 rounded-full bg-[#7f74ff] opacity-75 animate-[bounce_1s_infinite]" />
            <span className="h-2 w-2 rounded-full bg-[#7f74ff] opacity-75 animate-[bounce_1s_infinite] [animation-delay:120ms]" />
            <span className="h-2 w-2 rounded-full bg-[#7f74ff] opacity-75 animate-[bounce_1s_infinite] [animation-delay:240ms]" />
          </div>
        ) : null}
      </MessagePrimitive.If>
      <MessagePrimitive.If hasContent>
        <div>
          <AssistantReasoningOutside />
          {hasTextContent ? (
            <div className="aui-assistant-message-content">
              <MessagePrimitive.Content
                components={{
                  Reasoning: NullReasoningPart,
                  Text: AssistantText,
                }}
              />
            </div>
          ) : null}
        </div>
      </MessagePrimitive.If>
      <BranchPicker />
      <AssistantActionBar />
    </AssistantMessage.Root>
  );
}
