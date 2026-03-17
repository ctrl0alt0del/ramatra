import { buildBiasedCritiqueLmStudioInput } from "@/lib/tasks/chat/critique-input";
import {
  executeCritiqueStage,
  type CritiqueLmStudioOutput,
  type RequestLmStudioChat,
} from "@/lib/tasks/chat/handlers/critique-streaming";
import { threadRepository } from "@/lib/tasks/chat/adapters/thread-repository";
import { composeCritiqueSystemPrompt, biasedCritiqueSystemPrompt } from "@/lib/tasks/chat/prompts";
import type { TaskGroup } from "@/lib/tasks/types";
import { applyCritiqueTaskCompletion } from "@/lib/tasks/chat/handlers/critique-stage-completion";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;
type CritiqueTask = ChatTask & {
  payload: Extract<ChatTask["payload"], { kind: "critique" }>;
};

export const executeBiasedCritiqueStage = async ({
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
  const savedIntent =
    task.payload.threadId
      ? (threadRepository.getById(task.payload.threadId)?.userIntent ?? "")
      : "";
  const biasedInputItems = buildBiasedCritiqueLmStudioInput({
    comfyTaskId: task.payload.comfyTaskId,
    imageIndex: task.payload.imageIndex,
    savedIntent,
    unbiasedCritique: task.result?.unbiasedCritique ?? "",
  });

  const { finalText, finalReasoning, finalResponseId } = await executeCritiqueStage({
    task,
    modelTarget,
    requestedContextLength,
    input: biasedInputItems,
    systemPrompt: composeCritiqueSystemPrompt({
      basePrompt: biasedCritiqueSystemPrompt,
      moodId,
    }),
    fallbackMessage: "Biased critique request failed.",
    streamingErrorMessage: "Biased critique streaming error.",
    requestLmStudioChat,
    getAssistantText,
    getAssistantReasoning,
  });

  applyCritiqueTaskCompletion({
    taskId: task.id,
    kind: "chat.biased_critique",
    finalText,
    finalReasoning,
    finalResponseId,
  });
};
