export const finalizeConversationViaStreamTask = ({
  taskId,
  text,
  reasoning,
  responseId,
  summaryCallsInCurrentRequest,
  updateRunningTask,
  setGroupTaskStatusByKind,
}: {
  taskId: string;
  text: string;
  reasoning: string;
  responseId: string | null;
  summaryCallsInCurrentRequest: number;
  updateRunningTask: (
    taskId: string,
    patch: {
      result: {
        text: string;
        reasoning: string;
        responseId: string | null;
        summaryCallsInCurrentRequest: number;
      };
    },
  ) => void;
  setGroupTaskStatusByKind: (args: {
    taskId: string;
    kind: "chat.stream";
    status: "completed";
  }) => void;
}) => {
  updateRunningTask(taskId, {
    result: {
      text,
      reasoning,
      responseId,
      summaryCallsInCurrentRequest,
    },
  });
  setGroupTaskStatusByKind({
    taskId,
    kind: "chat.stream",
    status: "completed",
  });
};
