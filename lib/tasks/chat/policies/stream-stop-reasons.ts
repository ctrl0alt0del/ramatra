type ChatResponseLike = {
  finish_reason?: string;
  stop_reason?: string;
  usage?: Record<string, unknown>;
  stats?: Record<string, unknown>;
};

const isContextOverflowText = (value: string | null | undefined) => {
  if (!value) {
    return false;
  }

  const normalized = value.toLowerCase();
  return (
    normalized.includes("context") ||
    normalized.includes("token") ||
    normalized.includes("length")
  );
};

export const isFailedStopText = (value: string | null | undefined) => {
  if (!value) {
    return false;
  }

  const normalized = value.toLowerCase();
  return normalized === "failed" || normalized.includes("fail");
};

const isLengthStopText = (value: string | null | undefined) => {
  if (!value) {
    return false;
  }

  const normalized = value.toLowerCase();
  return (
    normalized === "length" ||
    normalized.includes("max_tokens") ||
    normalized.includes("max token") ||
    normalized.includes("context length")
  );
};

export const isContextOverflowSignal = ({
  stopReason,
  finishReason,
  errorMessage,
}: {
  stopReason: string | null;
  finishReason: string | null;
  errorMessage?: string | null;
}) => {
  if (
    isContextOverflowText(stopReason) ||
    isContextOverflowText(finishReason) ||
    isContextOverflowText(errorMessage)
  ) {
    return true;
  }

  return isLengthStopText(stopReason) || isLengthStopText(finishReason);
};

const readStringField = (value: unknown) => {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
};

export const getChatStopSignals = (response: ChatResponseLike | null) => {
  if (!response) {
    return {
      stopReason: null as string | null,
      finishReason: null as string | null,
    };
  }

  const usage = (response.usage ?? {}) as Record<string, unknown>;
  const stats = (response.stats ?? {}) as Record<string, unknown>;

  const stopReason =
    readStringField(response.stop_reason) ??
    readStringField(response.finish_reason) ??
    readStringField(stats.stop_reason) ??
    readStringField(stats.stopReason) ??
    readStringField(stats.finish_reason) ??
    readStringField(stats.finishReason) ??
    readStringField(usage.stop_reason) ??
    readStringField(usage.stopReason) ??
    readStringField(usage.finish_reason) ??
    readStringField(usage.finishReason) ??
    null;

  const finishReason =
    readStringField(response.finish_reason) ??
    readStringField(response.stop_reason) ??
    readStringField(stats.finish_reason) ??
    readStringField(stats.finishReason) ??
    readStringField(stats.stop_reason) ??
    readStringField(stats.stopReason) ??
    readStringField(usage.finish_reason) ??
    readStringField(usage.finishReason) ??
    readStringField(usage.stop_reason) ??
    readStringField(usage.stopReason) ??
    null;

  return {
    stopReason,
    finishReason,
  };
};
