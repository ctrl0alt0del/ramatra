import type { Task, TaskGroup } from "@/lib/tasks/types";
import {
  setConversationGenerateAndStreamFailed,
  setCritiqueFromBiasedFailed,
  setCritiqueFromUnbiasedFailed,
} from "@/lib/tasks/chat/handlers/task-status-transitions";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export const applyChatFailureTransitions = ({
  task,
  taskKind,
  setGroupTaskStatusByKind,
  updateThread,
}: {
  task: ChatTask;
  taskKind: Task["kind"];
  setGroupTaskStatusByKind: (args: {
    taskId: string;
    kind:
      | "chat.generate"
      | "chat.intent"
      | "chat.unbiased_critique"
      | "chat.biased_critique"
      | "chat.stream"
      | "chat.compact"
      | "chat.title";
    status: "failed";
  }) => void;
  updateThread: (
    threadId: string,
    patch: { summaryCallsInCurrentRequest: number },
  ) => unknown;
}) => {
  if (task.payload.kind === "conversation") {
    if (taskKind === "chat.generate") {
      setConversationGenerateAndStreamFailed({
        taskId: task.id,
        setGroupTaskStatusByKind,
      });
    } else if (taskKind === "chat.stream") {
      setGroupTaskStatusByKind({
        taskId: task.id,
        kind: "chat.stream",
        status: "failed",
      });
    }
  }

  if (task.payload.kind === "critique") {
    if (taskKind === "chat.unbiased_critique") {
      setCritiqueFromUnbiasedFailed({
        taskId: task.id,
        setGroupTaskStatusByKind,
      });
    } else if (taskKind === "chat.biased_critique") {
      setCritiqueFromBiasedFailed({
        taskId: task.id,
        setGroupTaskStatusByKind,
      });
    } else if (taskKind === "chat.stream") {
      setGroupTaskStatusByKind({
        taskId: task.id,
        kind: "chat.stream",
        status: "failed",
      });
    }
  }

  if (task.payload.kind === "update_intent") {
    setGroupTaskStatusByKind({
      taskId: task.id,
      kind: "chat.intent",
      status: "failed",
    });
  }
  if (task.payload.kind === "collapse_context") {
    setGroupTaskStatusByKind({
      taskId: task.id,
      kind: "chat.compact",
      status: "failed",
    });
  }
  if (task.payload.kind === "generate_title") {
    setGroupTaskStatusByKind({
      taskId: task.id,
      kind: "chat.title",
      status: "failed",
    });
  }
  if (
    task.payload.kind === "conversation" &&
    task.payload.threadId &&
    task.payload.persistent !== false
  ) {
    updateThread(task.payload.threadId, {
      summaryCallsInCurrentRequest: 0,
    });
  }
};
