const LM_STUDIO_SAMPLING_KEYS = [
  "temperature",
  "top_k",
  "top_p",
  "min_p",
  "typical_p",
  "tfs_z",
  "repeat_penalty",
  "presence_penalty",
  "frequency_penalty",
  "mirostat",
  "mirostat_tau",
  "mirostat_eta",
] as const;

export type LmStudioSamplingParams = Partial<
  Record<(typeof LM_STUDIO_SAMPLING_KEYS)[number], number>
>;

export const stripForbiddenLmStudioSamplingParams = (
  payload: Record<string, unknown>,
) => {
  const next = { ...payload };

  for (const key of LM_STUDIO_SAMPLING_KEYS) {
    if (key in next) {
      delete next[key];
    }
  }

  return next;
};

export const sanitizeLmStudioSamplingParams = (
  sampling?: LmStudioSamplingParams,
): LmStudioSamplingParams => {
  if (!sampling) {
    return {};
  }

  const next: LmStudioSamplingParams = {};

  for (const key of LM_STUDIO_SAMPLING_KEYS) {
    const value = sampling[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      next[key] = value;
    }
  }

  return next;
};
