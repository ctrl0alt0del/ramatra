export const tryParseJsonLikeText = (raw: string): unknown | null => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const codeFenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = codeFenceMatch ? codeFenceMatch[1].trim() : trimmed;
  if (!candidate) {
    return null;
  }

  const looksJson =
    (candidate.startsWith("{") && candidate.endsWith("}")) ||
    (candidate.startsWith("[") && candidate.endsWith("]"));
  if (!looksJson) {
    return null;
  }

  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
};

export const collectJsonStringLeaves = (value: unknown): string[] => {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectJsonStringLeaves(item));
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((item) =>
      collectJsonStringLeaves(item),
    );
  }
  return [];
};
