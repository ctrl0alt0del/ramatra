const FORBIDDEN_LM_STUDIO_SAMPLING_KEYS = [
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

export const stripForbiddenLmStudioSamplingParams = (
  payload: Record<string, unknown>,
) => {
  const next = { ...payload };

  for (const key of FORBIDDEN_LM_STUDIO_SAMPLING_KEYS) {
    if (key in next) {
      delete next[key];
    }
  }

  return next;
};
