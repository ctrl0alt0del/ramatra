const TOOL_STREAM_LOG_PREVIEW_CHARS = 800;

export const isLmStudioModelDebugEnabled = () =>
  process.env.LM_STUDIO_DEBUG_MODEL_ROUTING === "true";

export const truncateForLog = (
  value: string,
  maxChars = TOOL_STREAM_LOG_PREVIEW_CHARS,
) => {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}... [truncated ${value.length - maxChars} chars]`;
};

export const isLikelyToolStreamEvent = (
  eventType: string,
  data: Record<string, unknown>,
) => {
  const normalizedType = eventType.toLowerCase();
  if (normalizedType.includes("tool") || normalizedType.includes("mcp")) {
    return true;
  }

  const keys = Object.keys(data).map((key) => key.toLowerCase());
  return keys.some((key) => {
    return (
      key.includes("tool") ||
      key.includes("mcp") ||
      key.includes("call") ||
      key.includes("arguments") ||
      key.includes("result")
    );
  });
};

export const logToolStreamEvent = ({
  taskId,
  threadId,
  eventType,
  data,
}: {
  taskId: string;
  threadId: string | null;
  eventType: string;
  data: Record<string, unknown>;
}) => {
  if (!isLikelyToolStreamEvent(eventType, data)) {
    return;
  }

  let serialized = "";
  try {
    serialized = JSON.stringify(data);
  } catch {
    serialized = "[unserializable payload]";
  }

  console.info("[chat-runner] stream:tool-event", {
    taskId,
    threadId,
    eventType,
    payloadKeys: Object.keys(data),
    payloadPreview: truncateForLog(serialized),
  });
};

export const logChatModelDebug = (
  phase: string,
  payload: Record<string, unknown>,
) => {
  if (!isLmStudioModelDebugEnabled()) {
    return;
  }

  console.info("[chat-runner] model:route", {
    phase,
    ...payload,
  });
};

export const formatUnknownError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
    stack: null,
  };
};
