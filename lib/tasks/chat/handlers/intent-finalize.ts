import { threadRepository } from "@/lib/tasks/chat/adapters/thread-repository";
import { taskRepository } from "@/lib/tasks/chat/adapters/task-repository";

export const finalizeIntentUpdate = ({
  taskId,
  threadId,
  nextIntent,
  responseId,
}: {
  taskId: string;
  threadId: string;
  nextIntent: string;
  responseId: string | null;
}) => {
  threadRepository.updateById(threadId, {
    userIntent: nextIntent || null,
  });

  taskRepository.updateRunningTask(taskId, {
    result: {
      text: nextIntent,
      reasoning: "",
      responseId,
      summaryCallsInCurrentRequest: 0,
    },
  });
  taskRepository.setGroupTaskStatusByKind({
    taskId,
    kind: "chat.intent",
    status: "completed",
  });
};
