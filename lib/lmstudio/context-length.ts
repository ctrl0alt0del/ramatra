import { type PromptMode } from "./prompt-modes";

export const defaultContextLengthByMode: Record<PromptMode, number> = {
  fast: 4_096,
  regular: 16_384,
  artist: 16_384,
  writer: 65_536,
  roleplay: 65_536,
};

export const getDefaultContextLengthForMode = (mode: PromptMode) => {
  return defaultContextLengthByMode[mode];
};

export const getConfiguredContextLengthForMode = (
  mode: PromptMode,
  env: NodeJS.ProcessEnv,
) => {
  const envKey = `LM_STUDIO_CONTEXT_LENGTH_${mode.toUpperCase()}` as const;
  const envValue = env[envKey];
  const parsedValue = envValue ? Number.parseInt(envValue, 10) : Number.NaN;

  if (Number.isFinite(parsedValue) && parsedValue > 0) {
    return parsedValue;
  }

  return getDefaultContextLengthForMode(mode);
};
