import { executeConversationRuntime } from "@/lib/tasks/chat/handlers/conversation-runtime";
import { createConversationRuntimeDeps } from "@/lib/tasks/chat/handlers/conversation-runtime-deps";
import { threadRepository } from "@/lib/tasks/chat/adapters/thread-repository";
import type { PromptMode } from "@/lib/lmstudio/prompt-modes";
import type { Task, TaskGroup, TaskGroupPayloadMap, TaskGroupResultMap } from "@/lib/tasks/types";

type ChatTask = Extract<TaskGroup, { type: "chat" }>;

export const executeConversationDispatch = ({
  task,
  taskKind,
  thread,
  promptMode,
  moodId,
  requestedContextLength,
  isPersistentConversation,
  compactThresholdRatio,
  getChatModelKey,
  setGroupTaskStatusByKind,
  updateRunningTask,
  updateChatTaskPayload,
  updateThread,
  getPendingChatStreams,
}: {
  task: ChatTask;
  taskKind: "chat.generate" | "chat.stream";
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
  getPendingChatStreams: () => Map<
    string,
    {
      stream: ReadableStream<Uint8Array>;
      promptMode: PromptMode;
      requestedContextLength: number;
      modelTarget: string;
      summaryCallsInCurrentRequest: number;
    }
  >;
}) =>
  executeConversationRuntime({
    task,
    taskKind,
    thread,
    promptMode,
    moodId,
    requestedContextLength,
    isPersistentConversation,
    compactThresholdRatio,
    ...createConversationRuntimeDeps({
      getChatModelKey,
      setGroupTaskStatusByKind,
      updateRunningTask,
      updateChatTaskPayload,
      updateThread,
      getPendingChatStreams,
    }),
  });
