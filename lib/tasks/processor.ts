import {
  getActiveTask,
  getNextRunnableGroupTask,
  getNextSchedulableTask,
  markTaskCompleted,
  markTaskFailed,
  markTaskStarted,
} from "@/lib/tasks/scheduler";
import { getPendingComfyStreamSession } from "@/lib/tasks/comfy-stream-session";

declare global {
  var __comfyBridgeTaskProcessorPromise: Promise<void> | null | undefined;
}

const logTaskOrchestration = (phase: string, payload: Record<string, unknown>) => {
  console.info(`[task-orch] ${phase}`, payload);
};

export const processTaskQueues = async () => {
  if (globalThis.__comfyBridgeTaskProcessorPromise) {
    return globalThis.__comfyBridgeTaskProcessorPromise;
  }

  globalThis.__comfyBridgeTaskProcessorPromise = (async () => {
    while (true) {
      let activeTask = getActiveTask();
      if (!activeTask) {
        const nextTask = getNextSchedulableTask();
        if (!nextTask) {
          break;
        }
        activeTask = markTaskStarted(nextTask.id);
        if (!activeTask) {
          break;
        }
        logTaskOrchestration("group:started", {
          taskGroupId: activeTask.id,
          type: activeTask.type,
        });
      }

      if (
        activeTask.type === "comfy" &&
        activeTask.status === "running" &&
        typeof activeTask.result?.jobId === "string"
      ) {
        const streamTask = (activeTask.payload.tasks ?? []).find(
          (task) => task.kind === "image.stream",
        );
        const pendingStreamSession = getPendingComfyStreamSession(activeTask.id);
        if (streamTask?.status === "running" && pendingStreamSession) {
          break;
        }
      }

      const runnable = getNextRunnableGroupTask(activeTask.id);
      if (!runnable) {
        const groupTasks = activeTask.payload.tasks ?? [];
        const hasTasks = groupTasks.length > 0;
        const allCompleted =
          hasTasks && groupTasks.every((groupTask) => groupTask.status === "completed");
        const hasFailed = groupTasks.some((groupTask) => groupTask.status === "failed");

        if (activeTask.status === "running" && hasFailed) {
          markTaskFailed(activeTask.id, activeTask.error ?? "Task step failed.");
          logTaskOrchestration("group:failed", {
            taskGroupId: activeTask.id,
          });
          continue;
        }

        if (activeTask.status === "running" && allCompleted) {
          markTaskCompleted(activeTask.id, activeTask.result ?? undefined);
          logTaskOrchestration("group:completed", {
            taskGroupId: activeTask.id,
          });
          continue;
        }

        break;
      }

      const { task, groupTask } = runnable;
      logTaskOrchestration("task:execute", {
        taskGroupId: task.id,
        taskId: groupTask.id,
        kind: groupTask.kind,
      });

      if (task.type === "chat") {
        const { prepareChatGpuForTaskGroup } = await import("@/lib/tasks/gpu-manager");
        await prepareChatGpuForTaskGroup(task);
        const { executeQueuedChatTask } = await import("@/lib/tasks/chat-runner");
        await executeQueuedChatTask(task.id, groupTask.kind);
        continue;
      }

      const { executeQueuedComfyTask } = await import("@/lib/tasks/comfy-runner");
      await executeQueuedComfyTask(task.id, groupTask.kind);
      break;
    }
  })();

  try {
    await globalThis.__comfyBridgeTaskProcessorPromise;
  } finally {
    globalThis.__comfyBridgeTaskProcessorPromise = null;
  }
};
