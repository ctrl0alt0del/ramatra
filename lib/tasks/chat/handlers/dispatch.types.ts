import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import { threadRepository } from "@/lib/tasks/chat/adapters/thread-repository";
import type { Task, TaskGroup, TaskGroupPayloadMap, TaskGroupResultMap } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export type PendingChatStream = {
  stream: ReadableStream<Uint8Array>;
  promptMode: PromptMode;
  requestedContextLength: number;
  modelTarget: string;
  summaryCallsInCurrentRequest: number;
};

export type DispatchContext = {
  task: ChatTask;
  taskKind: Task["kind"];
  thread: ReturnType<typeof threadRepository.getById>;
  promptMode: PromptMode;
  moodId: string | null;
  requestedContextLength: number;
  isPersistentConversation: boolean;
  compactThresholdRatio: number;
  getChatModelKey: () => string;
  setGroupTaskStatusByKind: (args: {
    taskId: string;
    kind: Task["kind"];
    status: "pending" | "completed";
  }) => void;
  updateRunningTask: (
    taskId: string,
    patch: { result: TaskGroupResultMap["chat"] },
  ) => void;
  updateChatTaskPayload: (
    taskId: string,
    payload: TaskGroupPayloadMap["chat"],
  ) => unknown;
  updateThread: (
    threadId: string,
    patch: Record<string, unknown>,
  ) => unknown;
  getPendingChatStreams: () => Map<string, PendingChatStream>;
};

export type DispatchHandler = (context: DispatchContext) => Promise<boolean> | boolean;
