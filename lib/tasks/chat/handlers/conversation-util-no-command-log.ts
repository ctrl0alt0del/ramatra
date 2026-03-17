import { truncateForLog } from "@/lib/tasks/chat/logging";
import type { TaskGroup } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export const logUtilTaskNoCommandIfNeeded = ({
  task,
  parsedCommand,
  text,
  reasoning,
}: {
  task: ChatTask;
  parsedCommand: { command: unknown | null };
  text: string;
  reasoning: string;
}) => {
  if (
    task.payload.kind === "conversation" &&
    typeof task.payload.utilTaskName === "string" &&
    task.payload.utilTaskName.trim().length > 0 &&
    !parsedCommand.command
  ) {
    console.info("[chat-runner] util-task:no-command-emitted", {
      taskGroupId: task.id,
      threadId: task.payload.threadId ?? null,
      utilTaskName: task.payload.utilTaskName,
      textPreview: truncateForLog(text, 320),
      reasoningPreview: truncateForLog(reasoning, 320),
    });
  }
};
