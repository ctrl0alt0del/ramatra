"use client";

import {
  MessagePartPrimitive,
  TextMessagePartProvider,
  useMessagePartText,
} from "@assistant-ui/react";
import { makeMarkdownText } from "@assistant-ui/react-ui";
import remarkGfm from "remark-gfm";

import { extractComfyJobMarker } from "./comfy-marker";
import { GeneratedImageCard } from "./GeneratedImageCard";

const MarkdownText = makeMarkdownText({
  remarkPlugins: [remarkGfm],
  preprocess(text) {
    return text
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");
  },
});

export function AssistantText() {
  const part = useMessagePartText();
  const text = "text" in part ? part.text : "";
  const { cleanText, marker } = extractComfyJobMarker(text);

  return (
    <>
      {cleanText ? (
        <TextMessagePartProvider text={cleanText} isRunning={part.status.type === "running"}>
          <MarkdownText />
        </TextMessagePartProvider>
      ) : null}
      {marker ? (
        <GeneratedImageCard
          taskId={marker.taskId}
          jobId={marker.jobId ?? null}
          initialStatus={marker.status}
        />
      ) : null}
      {!cleanText && !marker ? (
        <MessagePartPrimitive.Text className="aui-text" component="p" />
      ) : null}
    </>
  );
}
