import { taskRepository } from "@/lib/tasks/chat/adapters/task-repository";

export const applyCritiqueTaskCompletion = ({
  taskId,
  kind,
  finalText,
  finalReasoning,
  finalResponseId,
  extraResult,
}: {
  taskId: string;
  kind: "chat.unbiased_critique" | "chat.biased_critique";
  finalText: string;
  finalReasoning: string;
  finalResponseId: string | null;
  extraResult?: Record<string, unknown>;
}) => {
  taskRepository.updateRunningTask(taskId, {
    result: {
      ...(taskRepository.getById(taskId)?.result ?? {}),
      text: finalText,
      reasoning: finalReasoning,
      responseId: finalResponseId,
      summaryCallsInCurrentRequest: 0,
      ...(extraResult ?? {}),
    },
  });
  taskRepository.setGroupTaskStatusByKind({
    taskId,
    kind,
    status: "completed",
  });
};
