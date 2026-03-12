import { getClient } from "@/lib/comfy/client";
import { runWorkflow } from "@/lib/comfy/runner";
import { type WorkflowInput, type WorkflowName } from "@/lib/comfy/workflows/types";
import { processTaskQueues } from "@/lib/tasks/processor";
import {
  switchToChatGpuMode,
  switchToComfyGpuMode,
} from "@/lib/tasks/gpu-manager";
import {
  bindComfyJobToTask,
  markTaskFailed,
  markTaskStarted,
  updateRunningTask,
} from "@/lib/tasks/scheduler";
import { subscribeToTaskEvent } from "@/lib/tasks/event-bus";

declare global {
  var __comfyBridgeComfyQueueListenersReady: boolean | undefined;
}

export const executeQueuedComfyTask = async (taskId: string) => {
  const task = markTaskStarted(taskId);
  if (!task || task.type !== "comfy") {
    return;
  }

  await switchToComfyGpuMode();

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
      await switchToChatGpuMode();
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
    await switchToChatGpuMode();
  }
};

export const ensureComfyQueueListeners = () => {
  if (globalThis.__comfyBridgeComfyQueueListenersReady) {
    return;
  }

  subscribeToTaskEvent("task:completed", async ({ task }) => {
    if (task.type !== "comfy") return;
    await switchToChatGpuMode();
    void processTaskQueues();
  });

  subscribeToTaskEvent("task:failed", async ({ task }) => {
    if (task.type !== "comfy") return;
    await switchToChatGpuMode();
    void processTaskQueues();
  });

  subscribeToTaskEvent("task:cancelled", async ({ task }) => {
    if (task.type !== "comfy") return;
    await switchToChatGpuMode();
    void processTaskQueues();
  });

  globalThis.__comfyBridgeComfyQueueListenersReady = true;
};
