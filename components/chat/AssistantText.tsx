"use client";

import { MessagePartPrimitive, useMessagePartText } from "@assistant-ui/react";

import { extractComfyJobMarker } from "./comfy-marker";
import { GeneratedImageCard } from "./GeneratedImageCard";

export function AssistantText() {
  const part = useMessagePartText();
  const text = "text" in part ? part.text : "";
  const { cleanText, marker } = extractComfyJobMarker(text);

  return (
    <>
      {cleanText ? (
        <p className="aui-text whitespace-pre-wrap">{cleanText}</p>
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
