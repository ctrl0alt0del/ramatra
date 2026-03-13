import type { MessagePart } from "@/lib/chat/message-content";

export const taskTypes = ["chat", "comfy"] as const;

export type TaskType = (typeof taskTypes)[number];

export const taskStatuses = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export type TaskStatus = (typeof taskStatuses)[number];

export type TaskPayloadMap = {
  chat:
    | {
        kind: "conversation";
        threadId: string | null;
        promptMode: string;
        userMessage: MessagePart[];
      }
    | {
        kind: "generate_title";
        threadId: string;
      }
    | {
        kind: "collapse_context";
        threadId: string;
        promptMode: string;
      };
  comfy: {
    workflowName: string;
    prompt: string;
    negativePrompt: string;
    width: number;
    height: number;
    steps: number;
    cfg: number;
    seed: number;
    samplerName: string;
    scheduler: string;
    loras: {
      name: string;
      strength_model: number;
      strength_clip: number;
    }[];
  };
};

export type TaskResultMap = {
  chat: {
    text?: string;
    reasoning?: string;
    responseId?: string | null;
    summaryCallsInCurrentRequest?: number;
    title?: string;
    summaryCollapsed?: boolean;
  };
  comfy: {
    taskId?: string;
    jobId?: string;
    status?: "queued" | "running" | "completed" | "failed";
    progress?: {
      value: number | null;
      max: number | null;
      percentage: number | null;
      node: string | null;
    };
  };
};

export type BaseTask<TType extends TaskType = TaskType> = {
  id: string;
  type: TType;
  status: TaskStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  payload: TaskPayloadMap[TType];
  result: TaskResultMap[TType] | null;
};

export type Task =
  | BaseTask<"chat">
  | BaseTask<"comfy">;

export type TaskQueueSnapshot = {
  chat: Task[];
  comfy: Task[];
};

export type GpuMode = "chat" | "comfy" | "switching";

export type SchedulerSnapshot = {
  gpuMode: GpuMode;
  activeTaskId: string | null;
  queues: TaskQueueSnapshot;
};

export type TaskEventMap = {
  "task:queued": { task: Task };
  "task:started": { task: Task };
  "task:updated": { task: Task };
  "task:completed": { task: Task };
  "task:failed": { task: Task };
  "task:cancelled": { task: Task };
  "queue:changed": SchedulerSnapshot;
  "gpu:changed": SchedulerSnapshot;
};
