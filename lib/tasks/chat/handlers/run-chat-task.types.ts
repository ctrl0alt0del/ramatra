import { threadRepository } from "@/lib/tasks/chat/adapters/thread-repository";
import type { Task, TaskGroup } from "@/lib/tasks/types";

export type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export type RunChatTaskPipelineArgs = {
  task: ChatTask;
  taskKind: Task["kind"];
} & RunChatTaskPipelineDeps;

export type RunChatTaskPipelineDeps = {
  getChatModelKey: () => string;
  getThreadById: (threadId: string) => ReturnType<typeof threadRepository.getById>;
  updateThreadById: (
    threadId: string,
    patch: Record<string, unknown>,
  ) => ReturnType<typeof threadRepository.updateById>;
  setGroupTaskStatusByKind: (args: {
    taskId: string;
    kind: Task["kind"];
    status: "pending" | "completed";
  }) => void;
  updateRunningTask: (
    taskId: string,
    patch: {
      result: Extract<TaskGroup, { type: "chat" }>["result"];
    },
  ) => void;
  updateChatTaskPayload: (
    taskId: string,
    payload: Extract<TaskGroup, { type: "chat" }>["payload"],
  ) => unknown;
  getPendingChatStreams: () => Map<
    string,
    {
      stream: ReadableStream<Uint8Array>;
      promptMode: import("@/lib/lmstudio/prompt-modes").PromptMode;
      requestedContextLength: number;
      modelTarget: string;
      summaryCallsInCurrentRequest: number;
    }
  >;
};
