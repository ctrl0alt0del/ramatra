import { getMoodPromptById } from "@/lib/lmstudio/moods";

export const composeCritiqueSystemPrompt = ({
  basePrompt,
  moodId,
}: {
  basePrompt: string;
  moodId: string | null;
}) => {
  const moodPrompt = getMoodPromptById(moodId);
  if (!moodPrompt) {
    return basePrompt;
  }

  return [
    basePrompt,
    "Use this mood overlay to influence your critiques:",
    moodPrompt,
  ].join("\n\n");
};
