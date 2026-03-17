import { buildUnbiasedCritiqueLmStudioInput } from "@/lib/tasks/chat/critique-input";
import {
  executeCritiqueStage,
  type CritiqueLmStudioOutput,
  type RequestLmStudioChat,
} from "@/lib/tasks/chat/handlers/critique-streaming";
import {
  composeCritiqueSystemPrompt,
  unbiasedCritiqueSystemPrompt,
} from "@/lib/tasks/chat/prompts";
import type { TaskGroup } from "@/lib/tasks/types";
import { applyCritiqueTaskCompletion } from "@/lib/tasks/chat/handlers/critique-stage-completion";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;
type CritiqueTask = ChatTask & {
  payload: Extract<ChatTask["payload"], { kind: "critique" }>;
};

export const executeUnbiasedCritiqueStage = async ({
  task,
  modelTarget,
  requestedContextLength,
  moodId,
  requestLmStudioChat,
  getAssistantText,
  getAssistantReasoning,
}: {
  task: CritiqueTask;
  modelTarget: string;
  requestedContextLength: number;
  moodId: string | null;
  requestLmStudioChat: RequestLmStudioChat;
  getAssistantText: (output: CritiqueLmStudioOutput[] | undefined) => string;
  getAssistantReasoning: (output: CritiqueLmStudioOutput[] | undefined) => string;
}) => {
  const { finalText, finalReasoning, finalResponseId } = await executeCritiqueStage({
    task,
    modelTarget,
    requestedContextLength,
    input: buildUnbiasedCritiqueLmStudioInput({
      comfyTaskId: task.payload.comfyTaskId,
      imageIndex: task.payload.imageIndex,
    }),
    systemPrompt: composeCritiqueSystemPrompt({
      basePrompt: unbiasedCritiqueSystemPrompt,
      moodId,
    }),
    fallbackMessage: "Unbiased critique request failed.",
    streamingErrorMessage: "Unbiased critique streaming error.",
    requestLmStudioChat,
    getAssistantText,
    getAssistantReasoning,
  });

  applyCritiqueTaskCompletion({
    taskId: task.id,
    kind: "chat.unbiased_critique",
    finalText,
    finalReasoning,
    finalResponseId,
    extraResult: {
      unbiasedCritique: finalText,
      unbiasedReasoning: finalReasoning,
    },
  });
};
