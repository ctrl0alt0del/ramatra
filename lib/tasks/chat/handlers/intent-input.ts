export const buildIntentInput = ({
  previousIntent,
  previousAssistantContent,
  latestUserMessage,
}: {
  previousIntent: string;
  previousAssistantContent: string;
  latestUserMessage: string;
}) =>
  [
    "Previous saved intent:",
    previousIntent || "(none)",
    "",
    "Previous assistant response:",
    previousAssistantContent || "(none)",
    "",
    "Latest user message:",
    latestUserMessage || "(empty)",
  ].join("\n");
