import { truncateForLog, logToolStreamEvent, isLikelyToolStreamEvent, logChatModelDebug } from "@/lib/tasks/chat/logging";
import type { StreamChatResponse } from "@/lib/tasks/chat/stream/types";

const MAX_TOOL_EVENTS_FOR_INTERRUPTION = 24;
const MAX_TOOL_EVENT_PREVIEW_CHARS = 1_200;
const MAX_TOOL_TRANSCRIPT_CHARS = 20_000;

type ToolEventSnapshot = {
  eventType: string;
  payloadKeys: string[];
  payloadPreview: string;
};

const toToolEventSnapshot = (
  eventType: string,
  data: Record<string, unknown>,
): ToolEventSnapshot => {
  let serialized = "";
  try {
    serialized = JSON.stringify(data);
  } catch {
    serialized = "[unserializable payload]";
  }

  return {
    eventType,
    payloadKeys: Object.keys(data),
    payloadPreview: truncateForLog(serialized, MAX_TOOL_EVENT_PREVIEW_CHARS),
  };
};

export const formatToolTranscriptForInterruption = (events: ToolEventSnapshot[]) => {
  if (!events.length) {
    return "";
  }

  const lines = events.map((event, index) => {
    const keys = event.payloadKeys.join(", ");
    return [
      `${index + 1}. ${event.eventType}`,
      `keys: ${keys || "(none)"}`,
      `payload: ${event.payloadPreview}`,
    ].join("\n");
  });

  return truncateForLog(lines.join("\n\n"), MAX_TOOL_TRANSCRIPT_CHARS);
};

export const createChatStreamEventReducer = ({
  taskId,
  threadId,
  modelTarget,
  onReasoningDelta,
  onMessageDelta,
  onPublishRunningResult,
}: {
  taskId: string;
  threadId: string | null;
  modelTarget: string;
  onReasoningDelta: (delta: string, responseId: string | null) => void;
  onMessageDelta: (delta: string, responseId: string | null) => void;
  onPublishRunningResult: (responseId: string | null) => void;
}) => {
  let streamedText = "";
  let streamedReasoning = "";
  let finalResponse: StreamChatResponse | null = null;
  const toolEvents: ToolEventSnapshot[] = [];

  return {
    onParsedEvent: (event: {
      type: string;
      content?: unknown;
      error?: { message?: string };
      result?: StreamChatResponse;
    }) => {
      if (event.type === "reasoning.delta" && typeof event.content === "string") {
        streamedReasoning += event.content;
        onReasoningDelta(event.content, finalResponse?.response_id ?? null);
        onPublishRunningResult(finalResponse?.response_id ?? null);
        return;
      }

      if (event.type === "message.delta" && typeof event.content === "string") {
        streamedText += event.content;
        onMessageDelta(event.content, finalResponse?.response_id ?? null);
        onPublishRunningResult(finalResponse?.response_id ?? null);
        return;
      }

      if (event.type === "error") {
        console.error("[chat-runner] stream:error-event", {
          taskId,
          threadId,
          selectedModelTarget: modelTarget,
          event,
        });
        throw new Error(event.error?.message ?? "LM Studio streaming error.");
      }

      if (event.type === "chat.end" && event.result) {
        finalResponse = event.result;
        const outputTypes = (event.result.output ?? []).map((part) => part.type);
        if (outputTypes.length > 0) {
          console.info("[chat-runner] stream:chat-end-output", {
            taskId,
            threadId,
            outputTypes,
          });
        }
        logChatModelDebug("request:end", {
          taskId,
          threadId,
          selectedModelTarget: modelTarget,
          responseId: event.result.response_id ?? null,
          responseModelInstanceId: event.result.model_instance_id ?? null,
          stopReason: event.result.stop_reason ?? null,
          finishReason: event.result.finish_reason ?? null,
          usage: event.result.usage ?? null,
        });
      }
    },
    onRawEvent: (eventType: string, data: Record<string, unknown>) => {
      logToolStreamEvent({
        taskId,
        threadId,
        eventType,
        data,
      });

      if (isLikelyToolStreamEvent(eventType, data)) {
        toolEvents.push(toToolEventSnapshot(eventType, data));
        if (toolEvents.length > MAX_TOOL_EVENTS_FOR_INTERRUPTION) {
          toolEvents.shift();
        }
      }
    },
    getState: () => ({
      streamedText,
      streamedReasoning,
      finalResponse,
      toolEvents,
    }),
  };
};
