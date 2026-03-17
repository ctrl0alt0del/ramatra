const MAX_CONTINUATION_PARTIAL_CHARS = 500;

export const buildOverflowInterruptionPayload = ({
  streamedText,
  overflowDetected,
  toolEventsTranscript,
}: {
  streamedText: string;
  overflowDetected: boolean;
  toolEventsTranscript: string;
}) => {
  const interruptedAssistantTailChars =
    streamedText.length > MAX_CONTINUATION_PARTIAL_CHARS
      ? streamedText.slice(-MAX_CONTINUATION_PARTIAL_CHARS)
      : streamedText;

  return {
    interrupted: true as const,
    interruptedAssistantTailChars,
    interruptedAssistantFullText: streamedText,
    interruptionContext: overflowDetected
      ? "The assistant response was interrupted during generation near context limit. Resume from this checkpoint, continue forward only, and avoid repeating already emitted items."
      : "The assistant response reached context capacity and requires continuation. Resume from this checkpoint, continue forward only, and avoid repeating already emitted items.",
    toolEventsTranscript,
  };
};
