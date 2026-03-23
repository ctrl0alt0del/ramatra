import { composeSystemPrompt } from "@/lib/lmstudio/prompts";
import { getLmStudioSamplingForMode } from "@/lib/lmstudio/mode-sampling";
import { buildIntegrations, type EphemeralMcpIntegration } from "@/lib/tasks/chat/integrations";
import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import type { LmStudioInputItem } from "@/lib/tasks/chat/lm-input";
import type { LmStudioSamplingParams } from "@/lib/tasks/chat/policies/lmstudio-sampling";

export const requestConversationChatGenerationStream = async ({
  modelTarget,
  requestedContextLength,
  promptMode,
  moodId,
  input,
  previousResponseId,
  systemPrompt,
  forceSystemPrompt,
  integrations,
  requestLmStudioChat,
}: {
  modelTarget: string;
  requestedContextLength: number;
  promptMode: PromptMode;
  moodId: string | null;
  input: string | LmStudioInputItem[];
  previousResponseId?: string;
  systemPrompt?: string;
  forceSystemPrompt?: boolean;
  integrations?: EphemeralMcpIntegration[];
  requestLmStudioChat: (args: {
    model: string;
    contextLength: number;
    input: string | LmStudioInputItem[];
    previousResponseId?: string;
    systemPrompt: string;
    forceSystemPrompt?: boolean;
    integrations?: EphemeralMcpIntegration[];
    sampling?: LmStudioSamplingParams;
    stream?: boolean;
  }) => Promise<Response>;
}) =>
  requestLmStudioChat({
    model: modelTarget,
    contextLength: requestedContextLength,
    input,
    previousResponseId,
    systemPrompt:
      systemPrompt ??
      composeSystemPrompt({
        mode: promptMode,
        moodId,
      }),
    forceSystemPrompt,
    integrations: integrations ?? buildIntegrations(promptMode),
    sampling: getLmStudioSamplingForMode(promptMode),
    stream: true,
  });
