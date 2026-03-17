import {
  ensureLmStudioModelLoaded,
  resolvePreferredLmStudioModelTarget,
} from "@/lib/lmstudio/models";
import {
  executeBiasedCritiqueStage,
  executeUnbiasedCritiqueStage,
} from "@/lib/tasks/chat/handlers/critique-stages";
import {
  type CritiqueLmStudioOutput,
  type RequestLmStudioChat,
} from "@/lib/tasks/chat/handlers/critique-streaming";
import type { Task, TaskGroup } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

const resolveCritiqueModelTarget = async ({
  modelKey,
  requestedContextLength,
}: {
  modelKey: string;
  requestedContextLength: number;
}) => {
  const exactLoadedModel = await ensureLmStudioModelLoaded({
    modelKey,
    contextLength: requestedContextLength,
  });
  return resolvePreferredLmStudioModelTarget({
    preferredInstanceId: exactLoadedModel.instanceId,
    modelKey,
  });
};

export const executeCritiqueTask = async ({
  task,
  taskKind,
  requestedContextLength,
  moodId,
  getChatModelKey,
  requestLmStudioChat,
  getAssistantText,
  getAssistantReasoning,
}: {
  task: ChatTask;
  taskKind: Task["kind"];
  requestedContextLength: number;
  moodId: string | null;
  getChatModelKey: () => string;
  requestLmStudioChat: RequestLmStudioChat;
  getAssistantText: (output: CritiqueLmStudioOutput[] | undefined) => string;
  getAssistantReasoning: (output: CritiqueLmStudioOutput[] | undefined) => string;
}) => {
  if (taskKind !== "chat.unbiased_critique" && taskKind !== "chat.biased_critique") {
    return false;
  }

  if (task.payload.kind !== "critique") {
    throw new Error(`${taskKind} task requires critique payload.`);
  }
  const critiqueTask = task as ChatTask & {
    payload: Extract<ChatTask["payload"], { kind: "critique" }>;
  };

  const modelTarget = await resolveCritiqueModelTarget({
    modelKey: getChatModelKey(),
    requestedContextLength,
  });

  if (taskKind === "chat.unbiased_critique") {
    await executeUnbiasedCritiqueStage({
      task: critiqueTask,
      modelTarget,
      requestedContextLength,
      moodId,
      requestLmStudioChat,
      getAssistantText,
      getAssistantReasoning,
    });
    return true;
  }

  await executeBiasedCritiqueStage({
    task: critiqueTask,
    modelTarget,
    requestedContextLength,
    moodId,
    requestLmStudioChat,
    getAssistantText,
    getAssistantReasoning,
  });
  return true;
};
