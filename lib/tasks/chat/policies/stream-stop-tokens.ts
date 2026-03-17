type ChatResponseLike = {
  usage?: Record<string, unknown>;
  stats?: Record<string, unknown>;
};

const readTokenCount = (input: unknown) => {
  if (typeof input === "number" && Number.isFinite(input)) {
    return Math.max(0, Math.floor(input));
  }

  if (typeof input === "string") {
    const parsed = Number.parseInt(input, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return null;
};

export const getUsedContextTokens = (response: ChatResponseLike | null) => {
  if (!response) {
    return null;
  }

  const usage = (response.usage ?? {}) as Record<string, unknown>;
  const stats = (response.stats ?? {}) as Record<string, unknown>;

  const inputTokens =
    readTokenCount(stats.input_tokens) ??
    readTokenCount(usage.input_tokens) ??
    readTokenCount(usage.prompt_tokens) ??
    readTokenCount(stats.prompt_tokens) ??
    readTokenCount(usage.promptTokensCount) ??
    readTokenCount(stats.promptTokensCount) ??
    null;
  const totalOutputTokens =
    readTokenCount(stats.total_output_tokens) ??
    readTokenCount(usage.total_output_tokens) ??
    readTokenCount(usage.output_tokens) ??
    readTokenCount(usage.completion_tokens) ??
    readTokenCount(stats.output_tokens) ??
    readTokenCount(stats.completion_tokens) ??
    readTokenCount(usage.predicted_tokens) ??
    readTokenCount(stats.predicted_tokens) ??
    readTokenCount(usage.generated_tokens) ??
    readTokenCount(stats.generated_tokens) ??
    readTokenCount(usage.predictedTokensCount) ??
    readTokenCount(stats.predictedTokensCount) ??
    null;

  if (inputTokens !== null && totalOutputTokens !== null) {
    return inputTokens + totalOutputTokens;
  }

  const totalTokens =
    readTokenCount(usage.total_tokens) ??
    readTokenCount(usage.totalTokens) ??
    readTokenCount(usage.totalTokensCount) ??
    readTokenCount(stats.total_tokens) ??
    readTokenCount(stats.totalTokens) ??
    readTokenCount(stats.totalTokensCount) ??
    null;
  if (totalTokens !== null) {
    return totalTokens;
  }

  return inputTokens;
};
