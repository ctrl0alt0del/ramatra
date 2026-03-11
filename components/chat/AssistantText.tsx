"use client";

import {
  MessagePartPrimitive,
  TextMessagePartProvider,
  useMessagePartText,
} from "@assistant-ui/react";
import { makeMarkdownText } from "@assistant-ui/react-ui";

import { extractComfyJobMarker } from "./comfy-marker";
import { GeneratedImageCard } from "./GeneratedImageCard";

const MarkdownText = makeMarkdownText();

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
          jobId={marker.jobId}
          initialStatus={marker.status}
        />
      ) : null}
      {!cleanText && !marker ? (
        <MessagePartPrimitive.Text className="aui-text" component="p" />
      ) : null}
    </>
  );
}
