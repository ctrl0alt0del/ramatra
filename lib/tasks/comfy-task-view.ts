import { getStoredGeneration } from "@/lib/comfy/generations";
import { getTask } from "@/lib/tasks/store";

export type ComfyTaskView =
  | {
      taskId: string;
      jobId: string | null;
      status: "queued" | "running";
      progress: {
        value: number | null;
        max: number | null;
        percentage: number | null;
        node: string | null;
      };
    }
  | {
      taskId: string;
      jobId: string | null;
      status: "failed";
      error: string;
    }
  | {
      taskId: string;
      jobId: string | null;
      status: "completed";
      images: {
        mimeType: string;
        data: string;
      }[];
    };

export const getComfyTaskView = (taskId: string): ComfyTaskView | null => {
  const task = getTask(taskId);
  if (!task || task.type !== "comfy") {
    return null;
  }

  const jobId = task.result?.jobId ?? null;

  if (task.status === "failed" || task.status === "cancelled") {
    return {
      taskId,
      jobId,
      status: "failed",
      error: task.error ?? "Generation failed.",
    };
  }

  if (task.status === "queued" || task.status === "running") {
    return {
      taskId,
      jobId,
      status: task.result?.status ?? task.status,
      progress: task.result?.progress ?? {
        value: null,
        max: null,
        percentage: null,
        node: null,
      },
    };
  }

  if (!jobId) {
    return {
      taskId,
      jobId: null,
      status: "completed",
      images: [],
    };
  }

  const stored = getStoredGeneration(jobId);
  if (!stored) {
    return {
      taskId,
      jobId,
      status: "completed",
      images: [],
    };
  }

  if (stored.status === "completed") {
    return {
      taskId,
      jobId,
      status: "completed",
      images: stored.images,
    };
  }

  if (stored.status === "failed") {
    return {
      taskId,
      jobId,
      status: "failed",
      error: stored.error ?? "Generation failed.",
    };
  }

  return {
    taskId,
    jobId,
    status: stored.status,
    progress: stored.progress,
  };
};
