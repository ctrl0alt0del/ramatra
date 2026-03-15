"use client";

import {
  MessagePartPrimitive,
  TextMessagePartProvider,
  useThreadListItemRuntime,
  useMessagePartText,
} from "@assistant-ui/react";
import { makeMarkdownText } from "@assistant-ui/react-ui";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import {
  hasContextCompactionMarker,
  splitTextByContextCompactionMarkers,
} from "@/lib/chat/context-compaction-marker";

import { extractComfyJobMarker } from "./comfy-marker";
import { ContextCompactionInline } from "./ContextCompactionInline";
import { GeneratedImageCard } from "./GeneratedImageCard";

const MarkdownText = makeMarkdownText({
  remarkPlugins: [remarkGfm, remarkMath],
  rehypePlugins: [rehypeKatex],
  preprocess(text) {
    return text
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");
  },
});

export function AssistantText() {
  const threadListItem = useThreadListItemRuntime();
  const threadId = threadListItem?.getState().remoteId ?? null;
  const part = useMessagePartText();
  const text = "text" in part ? part.text : "";
  const hasMarkers = hasContextCompactionMarker(text);
  const chunks = hasMarkers ? splitTextByContextCompactionMarkers(text) : null;

  return (
    <>
      {chunks
        ? chunks.map((chunk, index) => {
            const { cleanText, marker } = extractComfyJobMarker(chunk.text);
            return (
              <div key={`ctx-chunk-${index}`}>
                {cleanText ? (
                  <TextMessagePartProvider
                    text={cleanText}
                    isRunning={part.status.type === "running"}
                  >
                    <MarkdownText />
                  </TextMessagePartProvider>
                ) : null}
                {marker ? (
                  <GeneratedImageCard
                    taskId={marker.taskId}
                    jobId={marker.jobId ?? null}
                    initialStatus={marker.status}
                    threadId={threadId}
                  />
                ) : null}
                {chunk.markerCountAfter !== null ? (
                  <ContextCompactionInline
                    text="Context automatically compacted"
                  />
                ) : null}
              </div>
            );
          })
        : (() => {
            const { cleanText, marker } = extractComfyJobMarker(text);
            return (
              <>
                {cleanText ? (
                  <TextMessagePartProvider
                    text={cleanText}
                    isRunning={part.status.type === "running"}
                  >
                    <MarkdownText />
                  </TextMessagePartProvider>
                ) : null}
                {marker ? (
                  <GeneratedImageCard
                    taskId={marker.taskId}
                    jobId={marker.jobId ?? null}
                    initialStatus={marker.status}
                    threadId={threadId}
                  />
                ) : null}
                {!cleanText && !marker ? (
                  <MessagePartPrimitive.Text className="aui-text" component="p" />
                ) : null}
              </>
            );
          })()}
    </>
  );
}


