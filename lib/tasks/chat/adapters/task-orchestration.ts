import {
  enqueueChatTask,
  hasPendingTitleGenerationTask,
  markTaskCompleted,
  transferTaskByKind,
} from "@/lib/tasks/scheduler";

export const taskOrchestration = {
  enqueueChatTask,
  hasPendingTitleGenerationTask,
  markTaskCompleted,
  transferTaskByKind,
};
