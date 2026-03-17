import { threadRepository } from "@/lib/tasks/chat/adapters/thread-repository";
import { taskRepository } from "@/lib/tasks/chat/adapters/task-repository";
import { getChatModelKey, getPendingChatStreams } from "@/lib/tasks/chat/runtime-state";
import type { RunChatTaskPipelineDeps } from "@/lib/tasks/chat/handlers/run-chat-task.types";

export const createRunChatTaskPipelineDeps = (): RunChatTaskPipelineDeps => ({
  getChatModelKey,
  getThreadById: threadRepository.getById,
  updateThreadById: threadRepository.updateById,
  setGroupTaskStatusByKind: taskRepository.setGroupTaskStatusByKind,
  updateRunningTask: taskRepository.updateRunningTask,
  updateChatTaskPayload: taskRepository.updateChatTaskPayload,
  getPendingChatStreams,
});
