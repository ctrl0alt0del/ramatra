import { getAssistantReasoning, getAssistantText } from "@/lib/tasks/chat/output";
import {
  getChatStopSignals,
  getUsedContextTokens,
  isContextOverflowSignal,
  isFailedStopText,
} from "@/lib/tasks/chat/policies/stream-stop";
import { parseSseEvents } from "@/lib/tasks/chat/stream/sse";
import {
  createChatStreamEventReducer,
  formatToolTranscriptForInterruption,
} from "@/lib/tasks/chat/stream/event-reducer";
import type { StreamChatResponse } from "@/lib/tasks/chat/stream/types";

export const runChatStreamTask = async ({
  stream,
  taskId,
  threadId,
  modelTarget,
  onReasoningDelta,
  onMessageDelta,
  onPublishRunningResult,
}: {
  stream: ReadableStream<Uint8Array>;
  taskId: string;
  threadId: string | null;
  modelTarget: string;
  onReasoningDelta: (delta: string, responseId: string | null) => void;
  onMessageDelta: (delta: string, responseId: string | null) => void;
  onPublishRunningResult: (responseId: string | null) => void;
}): Promise<{
  overflowDetected: boolean;
  usedTokens: number | null;
  finalResponse: StreamChatResponse | null;
  toolEventsTranscript: string;
}> => {
  let localStreamErrorMessage: string | null = null;
  const reducer = createChatStreamEventReducer({
    taskId,
    threadId,
    modelTarget,
    onReasoningDelta,
    onMessageDelta,
    onPublishRunningResult,
  });

  try {
    await parseSseEvents<StreamChatResponse>({
      stream,
      onEvent: reducer.onParsedEvent,
      onRawEvent: reducer.onRawEvent,
    });
  } catch (error) {
    localStreamErrorMessage =
      error instanceof Error ? error.message : "LM Studio streaming error.";
  }

  const { streamedText, streamedReasoning, finalResponse, toolEvents } =
    reducer.getState();

  const resolvedFinalResponse = finalResponse as StreamChatResponse | null;
  const localResponseOutput = resolvedFinalResponse?.output;
  const localResponseId = resolvedFinalResponse?.response_id ?? null;
  const localText =
    (localResponseOutput?.length
      ? getAssistantText(localResponseOutput)
      : "") || streamedText;
  const localReasoning =
    (localResponseOutput?.length
      ? getAssistantReasoning(localResponseOutput)
      : "") || streamedReasoning;
  const interruptedWithoutEnd =
    !resolvedFinalResponse &&
    (streamedText.trim().length > 0 || streamedReasoning.trim().length > 0);
  const signals = getChatStopSignals(resolvedFinalResponse);
  const usedTokens = getUsedContextTokens(resolvedFinalResponse);
  const hasAnyAssistantOutput =
    streamedText.trim().length > 0 ||
    streamedReasoning.trim().length > 0 ||
    (localResponseOutput?.length ?? 0) > 0;
  const failedStopDetected =
    hasAnyAssistantOutput &&
    (isFailedStopText(signals.stopReason) ||
      isFailedStopText(signals.finishReason));
  const overflowDetected =
    interruptedWithoutEnd ||
    failedStopDetected ||
    isContextOverflowSignal({
      stopReason: signals.stopReason,
      finishReason: signals.finishReason,
      errorMessage: localStreamErrorMessage,
    });

  if (localStreamErrorMessage && !overflowDetected) {
    throw new Error(localStreamErrorMessage);
  }

  if (!streamedText && localText) {
    onMessageDelta(localText, localResponseId);
  }
  if (!streamedReasoning && localReasoning) {
    onReasoningDelta(localReasoning, localResponseId);
  }

  onPublishRunningResult(localResponseId);

  return {
    overflowDetected,
    usedTokens,
    finalResponse: resolvedFinalResponse,
    toolEventsTranscript: formatToolTranscriptForInterruption(toolEvents),
  };
};
