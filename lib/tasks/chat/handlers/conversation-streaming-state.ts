import { applyCompactionMarkersToText } from "@/lib/tasks/chat/text/compaction-markers";

export const createConversationStreamingState = ({
  initialText,
  initialReasoning,
  summaryCallsInCurrentRequest,
  updateRunningTask,
  taskId,
}: {
  initialText: string;
  initialReasoning: string;
  summaryCallsInCurrentRequest: number;
  updateRunningTask: (
    taskId: string,
    patch: {
      result: {
        text: string;
        reasoning: string;
        responseId: string | null;
        summaryCallsInCurrentRequest: number;
      };
    },
  ) => void;
  taskId: string;
}) => {
  let streamedText = initialText;
  let streamedReasoning = initialReasoning;
  const inRequestCompactionBreakOffsets: number[] = [];
  let lastPublishedAt = 0;
  const MIN_RUNNING_PUBLISH_INTERVAL_MS = 80;

  const publishRunningResult = (responseId: string | null) => {
    const now = Date.now();
    if (now - lastPublishedAt < MIN_RUNNING_PUBLISH_INTERVAL_MS) {
      return;
    }
    lastPublishedAt = now;

    const displayText = applyCompactionMarkersToText(
      streamedText,
      inRequestCompactionBreakOffsets,
    );
    updateRunningTask(taskId, {
      result: {
        text: displayText,
        reasoning: streamedReasoning,
        responseId,
        summaryCallsInCurrentRequest,
      },
    });
  };

  const appendReasoningDelta = (delta: string) => {
    streamedReasoning += delta;
  };

  const appendTextDelta = (delta: string) => {
    streamedText += delta;
  };

  return {
    publishRunningResult,
    appendReasoningDelta,
    appendTextDelta,
    getStreamedText: () => streamedText,
    getStreamedReasoning: () => streamedReasoning,
    inRequestCompactionBreakOffsets,
  };
};
