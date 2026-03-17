import type { PromptMode } from "@/lib/lmstudio/prompt-modes";

export type PendingChatStream = {
  stream: ReadableStream<Uint8Array>;
  promptMode: PromptMode;
  requestedContextLength: number;
  modelTarget: string;
  summaryCallsInCurrentRequest: number;
};

declare global {
  var __comfyBridgePendingChatStreams:
    | Map<string, PendingChatStream>
    | undefined;
}

export const getPendingChatStreams = () => {
  if (!globalThis.__comfyBridgePendingChatStreams) {
    globalThis.__comfyBridgePendingChatStreams = new Map();
  }
  return globalThis.__comfyBridgePendingChatStreams;
};

export const getChatModelKey = () => {
  const modelKey = process.env.LM_STUDIO_MODEL;
  if (!modelKey) {
    throw new Error("LM_STUDIO_MODEL is not configured.");
  }

  return modelKey;
};
