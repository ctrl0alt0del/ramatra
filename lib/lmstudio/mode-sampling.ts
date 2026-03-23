import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import {
  sanitizeLmStudioSamplingParams,
  type LmStudioSamplingParams,
} from "@/lib/tasks/chat/policies/lmstudio-sampling";

const modeSamplingByPromptMode: Partial<
  Record<PromptMode, LmStudioSamplingParams>
> = {
  roleplay: {
    repeat_penalty: 1.2,
    top_k: 50,
  },
};

export const getLmStudioSamplingForMode = (
  mode: PromptMode,
): LmStudioSamplingParams => {
  return sanitizeLmStudioSamplingParams(modeSamplingByPromptMode[mode]);
};
