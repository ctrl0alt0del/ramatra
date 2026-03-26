import { buildIntegrationsForServers } from "@/lib/tasks/chat/integrations";
import type { EphemeralMcpIntegration } from "@/lib/tasks/chat/integrations";
import type { LmStudioInputItem } from "@/lib/tasks/chat/lm-input";
import type { Task, TaskGroup } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export const executeConversationGenerateStage = async ({
  task,
  taskKind,
  userInput,
  effectivePreviousResponseId,
  openChatGenerationStream,
  setPendingStream,
  setGroupTaskStatusByKind,
}: {
  task: ChatTask;
  taskKind: Task["kind"];
  userInput: string | LmStudioInputItem[] | null;
  effectivePreviousResponseId: string | null;
  openChatGenerationStream: (args: {
    input: string | LmStudioInputItem[];
    previousResponseId?: string;
    systemPrompt?: string;
    integrations?: EphemeralMcpIntegration[];
    forceSystemPrompt?: boolean;
  }) => Promise<ReadableStream<Uint8Array>>;
  setPendingStream: (stream: ReadableStream<Uint8Array>) => void;
  setGroupTaskStatusByKind: (args: {
    taskId: string;
    kind: Task["kind"];
    status: "completed";
  }) => void;
}) => {
  if (taskKind !== "chat.generate") {
    return false;
  }

  if (userInput === null) {
    throw new Error(`${taskKind} task is missing input payload.`);
  }

  const normalizedUserInput =
    typeof userInput === "string" && userInput.length === 0 ? " " : userInput;
  const integrationOverride =
    task.payload.kind === "conversation" &&
    task.payload.disableMcpTools === true
      ? []
      : task.payload.kind === "conversation" &&
          Array.isArray(task.payload.utilMcpServers)
        ? buildIntegrationsForServers(task.payload.utilMcpServers, {
            promptMode: task.payload.promptMode,
          })
        : undefined;

  if (
    task.payload.kind === "conversation" &&
    typeof task.payload.utilTaskName === "string" &&
    task.payload.utilTaskName.trim().length > 0
  ) {
    console.info("[chat-runner] util-task:execute", {
      taskGroupId: task.id,
      threadId: task.payload.threadId ?? null,
      utilTaskName: task.payload.utilTaskName,
      utilCommandDepth: task.payload.utilCommandDepth ?? 0,
      utilEnqueueCount: task.payload.utilEnqueueCount ?? 0,
      hasSystemPromptExt:
        typeof task.payload.utilSystemPromptExt === "string" &&
        task.payload.utilSystemPromptExt.trim().length > 0,
    });
  }

  let stream: ReadableStream<Uint8Array>;
  try {
    if (task.payload.kind !== "conversation") {
      throw new Error("chat.generate task requires conversation payload.");
    }
    stream = await openChatGenerationStream({
      input: normalizedUserInput,
      previousResponseId: effectivePreviousResponseId ?? undefined,
      systemPrompt: task.payload.systemPromptOverride,
      forceSystemPrompt:
        typeof task.payload.systemPromptOverride === "string" &&
        task.payload.systemPromptOverride.trim().length > 0,
      integrations: integrationOverride,
    });
  } catch (error) {
    console.error("[chat-runner] generate:open-stream-failed", {
      taskId: task.id,
      threadId: task.payload.threadId ?? null,
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack ?? null,
            }
          : { name: "UnknownError", message: String(error), stack: null },
    });
    throw error;
  }

  setPendingStream(stream);
  setGroupTaskStatusByKind({
    taskId: task.id,
    kind: taskKind,
    status: "completed",
  });
  return true;
};
