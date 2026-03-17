import type { ChatResponse, ChatTask } from "@/lib/tasks/chat/handlers/conversation-runtime.types";

export const computeConversationOverflowMetrics = ({
  task,
  requestedContextLength,
  initialAttempt,
}: {
  task: ChatTask;
  requestedContextLength: number;
  initialAttempt: {
    overflowDetected: boolean;
    usedTokens: number | null;
    finalResponse: ChatResponse | null;
    toolEventsTranscript: string;
  };
}) => {
  const finalResponse: ChatResponse | null = initialAttempt.finalResponse;
  const overflowDetected = initialAttempt.overflowDetected;
  const nearLimitDetected =
    initialAttempt.usedTokens !== null &&
    initialAttempt.usedTokens >= requestedContextLength - 2;
  const continuationCount =
    task.payload.kind === "conversation"
      ? (task.payload.continuationIndex ?? 0)
      : 0;

  return {
    finalResponse,
    overflowDetected,
    nearLimitDetected,
    continuationCount,
    toolEventsTranscript: initialAttempt.toolEventsTranscript ?? "",
  };
};
