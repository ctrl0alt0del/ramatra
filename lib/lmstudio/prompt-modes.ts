export const promptModes = ["fast", "regular", "writer", "artist"] as const;

export type PromptMode = (typeof promptModes)[number];

export const defaultPromptMode: PromptMode = "regular";

export const promptModeLabels: Record<PromptMode, string> = {
  fast: "Fast",
  regular: "Regular",
  writer: "Writer",
  artist: "Artist",
};

export const promptModeDescriptions: Record<PromptMode, string> = {
  fast: "Quick text-only replies with minimal reasoning.",
  regular: "General-purpose text chat with a balanced prompt.",
  writer: "Text-only mode for stories, scenes, and polished writing.",
  artist: "Image-focused mode for prompt building and generation.",
};

export const isPromptMode = (value: string): value is PromptMode => {
  return (promptModes as readonly string[]).includes(value);
};
