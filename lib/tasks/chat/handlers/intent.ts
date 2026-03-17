import { getTextFromMessageContent } from "@/lib/chat/message-content";
import {
  ensureLmStudioModelLoaded,
  resolvePreferredLmStudioModelTarget,
} from "@/lib/lmstudio/models";
import type { EphemeralMcpIntegration } from "@/lib/tasks/chat/integrations";
import { finalizeIntentUpdate } from "@/lib/tasks/chat/handlers/intent-finalize";
import { buildIntentInput } from "@/lib/tasks/chat/handlers/intent-input";
import type {
  IntentChatResponse,
  LmStudioOutput,
} from "@/lib/tasks/chat/handlers/intent.types";
import { threadRepository } from "@/lib/tasks/chat/adapters/thread-repository";
import type { Task, TaskGroup } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export const executeIntentTask = async ({
  task,
  taskKind,
  requestedContextLength,
  intentUpdateSystemPrompt,
  getChatModelKey,
  requestLmStudioChat,
  getAssistantText,
  normalizeIntentToNaturalLanguage,
  balanceIntentWithPrevious,
}: {
  task: ChatTask;
  taskKind: Task["kind"];
  requestedContextLength: number;
  intentUpdateSystemPrompt: string;
  getChatModelKey: () => string;
  requestLmStudioChat: (args: {
    model: string;
    contextLength: number;
    input: string | Array<{ type: "text"; content: string } | { type: "image"; data_url: string }>;
    systemPrompt: string;
    stream?: boolean;
    integrations?: EphemeralMcpIntegration[];
  }) => Promise<Response>;
  getAssistantText: (output: LmStudioOutput[] | undefined) => string;
  normalizeIntentToNaturalLanguage: (raw: string) => string;
  balanceIntentWithPrevious: (args: {
    previousIntent: string;
    nextIntent: string;
  }) => string;
}) => {
  if (taskKind !== "chat.intent") {
    return false;
  }
  if (task.payload.kind !== "update_intent") {
    throw new Error("chat.intent task requires update_intent payload.");
  }

  const intentThread = threadRepository.getById(task.payload.threadId);
  if (!intentThread) {
    throw new Error("Intent update thread not found.");
  }

  const previousIntent = intentThread.userIntent ?? "";
  const previousAssistantText = [...intentThread.messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const previousAssistantContent = previousAssistantText
    ? getTextFromMessageContent(previousAssistantText.content)
    : "";
  const latestUserMessage = getTextFromMessageContent(task.payload.userMessage);

  const exactLoadedModel = await ensureLmStudioModelLoaded({
    modelKey: getChatModelKey(),
    contextLength: requestedContextLength,
  });
  const modelTarget = await resolvePreferredLmStudioModelTarget({
    preferredInstanceId: exactLoadedModel.instanceId,
    modelKey: getChatModelKey(),
  });

  const intentInput = buildIntentInput({
    previousIntent,
    previousAssistantContent,
    latestUserMessage,
  });

  const response = await requestLmStudioChat({
    model: modelTarget,
    contextLength: requestedContextLength,
    input: intentInput,
    systemPrompt: intentUpdateSystemPrompt,
  });

  const data = (await response.json()) as IntentChatResponse;
  if (!response.ok) {
    throw new Error(data.error?.message ?? "Intent update request failed.");
  }

  const nextIntent = balanceIntentWithPrevious({
    previousIntent,
    nextIntent: normalizeIntentToNaturalLanguage(getAssistantText(data.output)),
  });
  finalizeIntentUpdate({
    taskId: task.id,
    threadId: task.payload.threadId,
    nextIntent,
    responseId: data.response_id ?? null,
  });
  return true;
};
