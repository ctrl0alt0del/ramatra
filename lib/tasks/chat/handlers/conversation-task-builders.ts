import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import type { TaskGroupPayloadMap } from "@/lib/tasks/types";

type ConversationPayload = Extract<TaskGroupPayloadMap["chat"], { kind: "conversation" }>;

export const buildContinuationConversationPayload = ({
  sourcePayload,
  promptMode,
  moodId,
  contextLength,
  continuationIndex,
  carryoverText,
  carryoverReasoning,
}: {
  sourcePayload: ConversationPayload;
  promptMode: PromptMode;
  moodId: string | null;
  contextLength: number;
  continuationIndex: number;
  carryoverText?: string;
  carryoverReasoning?: string;
}): ConversationPayload => ({
  kind: "conversation",
  threadId: sourcePayload.threadId,
  promptMode,
  moodId,
  persistent: sourcePayload.persistent,
  contextLength,
  userMessage: sourcePayload.userMessage,
  continuationIndex,
  carryoverText,
  carryoverReasoning,
  systemPromptOverride: sourcePayload.systemPromptOverride,
  previousResponseIdOverride: sourcePayload.previousResponseIdOverride,
  utilChainBaseResponseId: sourcePayload.utilChainBaseResponseId,
  utilTaskName: sourcePayload.utilTaskName,
  utilSystemPromptExt: sourcePayload.utilSystemPromptExt,
  utilMcpServers: sourcePayload.utilMcpServers,
  utilCommandDepth: sourcePayload.utilCommandDepth,
  utilEnqueueCount: sourcePayload.utilEnqueueCount,
  utilCommandNonces: sourcePayload.utilCommandNonces,
  tasks: [
    {
      id: crypto.randomUUID(),
      kind: "chat.generate",
      status: "pending",
    },
  ],
});
