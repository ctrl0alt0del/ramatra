import { getUtilTaskSettingByName } from "@/lib/lmstudio/util-tasks";
import { type TaskGroup, type TaskGroupPayloadMap } from "@/lib/tasks/types";
import { buildBiasedCritiqueLmStudioInput } from "@/lib/tasks/chat/critique-input";
import { buildUtilDelegationContext } from "@/lib/tasks/chat/util/delegation-context";
import type { MessagePart } from "@/lib/chat/message-content";
import type { ParsedUtilCommandResult } from "@/lib/tasks/chat/util/command-chain-types";

type ChatTaskGroup = Extract<TaskGroup, { type: "chat" }>;

export const continueCritiqueUtilCommandInGroup = ({
  task,
  parsedCommand,
  requestedContextLength,
  moodId,
  savedIntent,
  unbiasedCritique,
  thread,
  buildUtilHistorySnapshot,
  updateChatTaskPayload,
}: {
  task: ChatTaskGroup;
  parsedCommand: ParsedUtilCommandResult;
  requestedContextLength: number;
  moodId: string | null;
  savedIntent: string;
  unbiasedCritique: string;
  thread: {
    messages: Array<{
      role: "user" | "assistant" | "system";
      content: MessagePart[];
    }>;
  } | null;
  buildUtilHistorySnapshot: (args: {
    thread: {
      messages: Array<{
        role: "user" | "assistant" | "system";
        content: MessagePart[];
      }>;
    } | null;
    currentUserMessage: MessagePart[];
  }) => string;
  updateChatTaskPayload: (
    taskId: string,
    payload: TaskGroupPayloadMap["chat"],
  ) => unknown;
}) => {
  if (task.payload.kind !== "critique" || !parsedCommand.command) {
    return { continued: false };
  }

  const utilTaskName = parsedCommand.command.stage.trim();
  const utilTaskSetting = getUtilTaskSettingByName(utilTaskName);
  if (!utilTaskSetting || !utilTaskSetting.enabled) {
    return { continued: false };
  }

  const biasedInputItems = buildBiasedCritiqueLmStudioInput({
    comfyTaskId: task.payload.comfyTaskId,
    imageIndex: task.payload.imageIndex,
    savedIntent,
    unbiasedCritique,
  });
  const conversationUserMessage = biasedInputItems.map((item) =>
    item.type === "text"
      ? {
          type: "text" as const,
          text: item.content,
        }
      : {
          type: "image" as const,
          dataUrl: item.data_url,
        },
  );
  const utilUserMessageSeed = conversationUserMessage;
  const { delegatedUserMessage, delegatedSystemPrompt, utilSystemPromptExt } =
    buildUtilDelegationContext({
      utilPrompt: utilTaskSetting.prompt,
      command: parsedCommand.command,
      utilUserMessageSeed,
      thread,
      buildUtilHistorySnapshot,
    });

  const existingStreamTaskId =
    task.payload.tasks?.find(
      (groupTask: { id: string; kind: string; status: string }) =>
        groupTask.kind === "chat.stream" && groupTask.status === "running",
    )?.id ?? crypto.randomUUID();

  updateChatTaskPayload(task.id, {
    kind: "conversation",
    threadId: task.payload.threadId ?? null,
    promptMode: "artist",
    moodId,
    contextLength: requestedContextLength,
    userMessage: delegatedUserMessage,
    persistent: parsedCommand.command.persistent === true,
    systemPromptOverride: delegatedSystemPrompt,
    previousResponseIdOverride: null,
    utilUserMessageSeed,
    utilTaskName,
    utilSystemPromptExt: utilSystemPromptExt || undefined,
    utilMcpServers: utilTaskSetting.mcpServers,
    utilCommandDepth: 1,
    utilEnqueueCount: 1,
    tasks: [
      {
        id: crypto.randomUUID(),
        kind: "chat.generate",
        status: "pending",
      },
      {
        id: existingStreamTaskId,
        kind: "chat.stream",
        status: "pending",
      },
    ],
  });

  console.info("[chat-runner] util-command:continued-in-group", {
    taskGroupId: task.id,
    utilTaskName,
    utilEnqueueCount: 1,
    source: "critique-stream",
  });

  return { continued: true };
};
