import {
  ensureCritiqueOkResponse,
  ensureCritiqueResponseBody,
} from "@/lib/tasks/chat/handlers/critique-response-guard";
import { collectCritiqueStreamResult } from "@/lib/tasks/chat/handlers/critique-stream-collector";
import type {
  ChatTask,
  CritiqueLmStudioOutput,
  RequestLmStudioChat,
} from "@/lib/tasks/chat/handlers/critique-streaming.types";
import type { LmStudioInputItem } from "@/lib/tasks/chat/input/types";

export type { CritiqueLmStudioOutput, RequestLmStudioChat };

export const executeCritiqueStage = async ({
  task,
  modelTarget,
  requestedContextLength,
  input,
  systemPrompt,
  fallbackMessage,
  streamingErrorMessage,
  requestLmStudioChat,
  getAssistantText,
  getAssistantReasoning,
}: {
  task: ChatTask;
  modelTarget: string;
  requestedContextLength: number;
  input: LmStudioInputItem[];
  systemPrompt: string;
  fallbackMessage: string;
  streamingErrorMessage: string;
  requestLmStudioChat: RequestLmStudioChat;
  getAssistantText: (output: CritiqueLmStudioOutput[] | undefined) => string;
  getAssistantReasoning: (output: CritiqueLmStudioOutput[] | undefined) => string;
}) => {
  const response = await requestLmStudioChat({
    model: modelTarget,
    contextLength: requestedContextLength,
    input,
    systemPrompt,
    integrations: [],
    stream: true,
  });
  await ensureCritiqueOkResponse({
    response,
    fallbackMessage,
  });

  const responseBody = ensureCritiqueResponseBody({
    response,
    fallbackMessage,
  });

  return collectCritiqueStreamResult({
    task,
    responseBody,
    streamingErrorMessage,
    getAssistantText,
    getAssistantReasoning,
  });
};
