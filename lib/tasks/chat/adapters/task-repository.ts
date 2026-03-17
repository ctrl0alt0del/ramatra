import {
  markTaskFailed,
  setGroupTaskStatusByKind,
  updateChatTaskPayload,
  updateRunningTask,
} from "@/lib/tasks/scheduler";
import { getTask } from "@/lib/tasks/store";

export const taskRepository = {
  getById: getTask,
  markFailed: markTaskFailed,
  setGroupTaskStatusByKind,
  updateChatTaskPayload,
  updateRunningTask,
};
