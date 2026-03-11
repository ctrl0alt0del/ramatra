import { getClient } from "@/lib/comfy/client";
import { runWorkflow } from "@/lib/comfy/runner";
import { type WorkflowInput, type WorkflowName } from "@/lib/comfy/workflows/types";
import {
  bindComfyJobToTask,
  canRunComfyQueue,
  getNextSchedulableTask,
  getSchedulerState,
  markTaskFailed,
  markTaskStarted,
  setSchedulerGpuMode,
  updateRunningTask,
} from "@/lib/tasks/scheduler";
import { subscribeToTaskEvent } from "@/lib/tasks/event-bus";
import {
  registerImageGenerationFinish,
  registerImageGenerationStart,
} from "@/lib/vram/balancer";

declare global {
  var __comfyBridgeComfyQueueWorkerPromise: Promise<void> | null | undefined;
  var __comfyBridgeComfyQueueListenersReady: boolean | undefined;
}

const executeComfyTask = async (taskId: string) => {
  const task = markTaskStarted(taskId);
  if (!task || task.type !== "comfy") {
    return;
  }

  setSchedulerGpuMode("switching");
  await registerImageGenerationStart(task.id);
  setSchedulerGpuMode("comfy");

  try {
    const result = await runWorkflow({
      client: await getClient(),
      workflowName: task.payload.workflowName as WorkflowName,
      input: {
        positivePrompt: task.payload.prompt,
        negativePrompt: task.payload.negativePrompt,
        width: task.payload.width,
        height: task.payload.height,
        steps: task.payload.steps,
        cfg: task.payload.cfg,
        seed: task.payload.seed,
        samplerName: task.payload.samplerName,
        scheduler: task.payload.scheduler,
        loras: task.payload.loras,
      } satisfies WorkflowInput,
    });

    if (!("jobId" in result)) {
      markTaskFailed(task.id, "Image generation failed before queueing.");
      await registerImageGenerationFinish(task.id);
      setSchedulerGpuMode("chat");
      return;
    }

    bindComfyJobToTask(task.id, result.jobId);
    updateRunningTask(task.id, {
      result: {
        taskId: task.id,
        jobId: result.jobId,
        status: result.status,
        progress: result.progress ?? {
          value: null,
          max: null,
          percentage: null,
          node: null,
        },
      },
    });
  } catch (error) {
    markTaskFailed(
      task.id,
      error instanceof Error ? error.message : "Failed to start Comfy task.",
    );
    await registerImageGenerationFinish(task.id);
    setSchedulerGpuMode("chat");
  }
};

export const processQueuedComfyTasks = async () => {
  if (globalThis.__comfyBridgeComfyQueueWorkerPromise) {
    return globalThis.__comfyBridgeComfyQueueWorkerPromise;
  }

  globalThis.__comfyBridgeComfyQueueWorkerPromise = (async () => {
    while (canRunComfyQueue()) {
      const nextTask = getNextSchedulableTask();
      if (!nextTask || nextTask.type !== "comfy") {
        break;
      }

      await executeComfyTask(nextTask.id);

      const snapshot = getSchedulerState();
      if (snapshot.activeTaskId !== null) {
        break;
      }
    }
  })();

  try {
    await globalThis.__comfyBridgeComfyQueueWorkerPromise;
  } finally {
    globalThis.__comfyBridgeComfyQueueWorkerPromise = null;
  }
};

export const ensureComfyQueueListeners = () => {
  if (globalThis.__comfyBridgeComfyQueueListenersReady) {
    return;
  }

  subscribeToTaskEvent("task:completed", async ({ task }) => {
    if (task.type !== "comfy") return;
    await registerImageGenerationFinish(task.id);
    setSchedulerGpuMode("chat");
    void processQueuedComfyTasks();
  });

  subscribeToTaskEvent("task:failed", async ({ task }) => {
    if (task.type !== "comfy") return;
    await registerImageGenerationFinish(task.id);
    setSchedulerGpuMode("chat");
    void processQueuedComfyTasks();
  });

  subscribeToTaskEvent("task:cancelled", async ({ task }) => {
    if (task.type !== "comfy") return;
    await registerImageGenerationFinish(task.id);
    setSchedulerGpuMode("chat");
    void processQueuedComfyTasks();
  });

  globalThis.__comfyBridgeComfyQueueListenersReady = true;
};
