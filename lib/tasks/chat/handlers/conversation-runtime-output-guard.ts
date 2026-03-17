export const assertConversationRuntimeHasOutput = ({
  text,
  reasoning,
  overflowDetected,
}: {
  text: string;
  reasoning: string;
  overflowDetected: boolean;
}) => {
  if (text.trim() || reasoning.trim()) {
    return;
  }
  if (overflowDetected) {
    throw new Error(
      "LM Studio reached the context limit before generating output. Context was compacted but continuation produced no output.",
    );
  }
  throw new Error("LM Studio did not return any output.");
};
