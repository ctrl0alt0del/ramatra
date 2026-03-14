import { getClient } from "@/lib/comfy/client";
import { runWorkflow } from "@/lib/comfy/runner";
import { type WorkflowInput, type WorkflowName } from "@/lib/comfy/workflows/types";
import {
  getPendingComfyStreamSession,
  setPendingComfyStreamSession,
} from "@/lib/tasks/comfy-stream-session";
import {
  switchToChatGpuMode,
  switchToComfyGpuMode,
} from "@/lib/tasks/gpu-manager";
import {
  bindComfyJobToTask,
  setGroupTaskStatusByKind,
  updateRunningTask,
} from "@/lib/tasks/scheduler";
import { getTask } from "@/lib/tasks/store";
import type { Task } from "@/lib/tasks/types";

declare global {
  var __comfyBridgeComfyQueueListenersReady: boolean | undefined;
}

export const executeQueuedComfyTask = async (
  taskId: string,
  taskKind: Task["kind"],
) => {
  const task = getTask(taskId);
  if (!task || task.type !== "comfy") {
    return;
  }

  if (taskKind === "image.stream") {
    const session = getPendingComfyStreamSession(task.id);
    if (!session) {
      throw new Error("image.stream task has no pending comfy stream session.");
    }
    setGroupTaskStatusByKind({
      taskId: task.id,
      kind: "image.stream",
      status: "running",
    });
    return;
  }
  if (taskKind !== "image.generate") {
    return;
  }

  setGroupTaskStatusByKind({
    taskId: task.id,
    kind: "image.generate",
    status: "running",
  });

  await switchToComfyGpuMode();

  try {
    const result = await runWorkflow({
      client: await getClient(),
      workflowName: task.payload.workflowName as WorkflowName,
      input: {
        positivePrompt: task.payload.prompt,
        negativePrompt: task.payload.negativePrompt,
        inputImage: Array.isArray(task.payload.inputImage) ? task.payload.inputImage : [],
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

    const jobId =
      "jobId" in result && typeof result.jobId === "string"
        ? result.jobId
        : null;
    if (!jobId) {
      const errorMessage = "Image generation failed before queueing.";
      setGroupTaskStatusByKind({
        taskId: task.id,
        kind: "image.generate",
        status: "failed",
      });
      updateRunningTask(task.id, {
        error: errorMessage,
      });
      await switchToChatGpuMode();
      return;
    }

    setGroupTaskStatusByKind({
      taskId: task.id,
      kind: "image.generate",
      status: "completed",
    });
    setGroupTaskStatusByKind({
      taskId: task.id,
      kind: "image.stream",
      status: "running",
    });
    setPendingComfyStreamSession({
      taskGroupId: task.id,
      jobId,
    });
    bindComfyJobToTask(task.id, jobId);
    const progress =
      "progress" in result && result.progress
        ? result.progress
        : {
            value: null,
            max: null,
            percentage: null,
            node: null,
          };
    updateRunningTask(task.id, {
      result: {
        taskId: task.id,
        jobId,
        status: result.status,
        progress,
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to start Comfy task.";
    setGroupTaskStatusByKind({
      taskId: task.id,
      kind: "image.generate",
      status: "failed",
    });
    updateRunningTask(task.id, {
      error: errorMessage,
    });
    await switchToChatGpuMode();
  }
};

export const ensureComfyQueueListeners = () => {
  if (globalThis.__comfyBridgeComfyQueueListenersReady) {
    return;
  }

  globalThis.__comfyBridgeComfyQueueListenersReady = true;
};

