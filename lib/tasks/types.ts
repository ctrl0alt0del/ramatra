import type { MessagePart } from "@/lib/chat/message-content";

export const taskGroupTypes = ["chat", "comfy"] as const;
export type TaskGroupType = (typeof taskGroupTypes)[number];

export const taskGroupStatuses = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type TaskGroupStatus = (typeof taskGroupStatuses)[number];

export const taskKinds = [
  "chat.generate",
  "chat.stream",
  "chat.compact",
  "chat.title",
  "image.generate",
  "image.stream",
] as const;
export type TaskKind = (typeof taskKinds)[number];

export const taskExecutionStatuses = [
  "pending",
  "running",
  "completed",
  "failed",
] as const;
export type TaskExecutionStatus = (typeof taskExecutionStatuses)[number];

// Executable unit inside a TaskGroup.
export type Task = {
  id: string;
  kind: TaskKind;
  status: TaskExecutionStatus;
  payload?: Record<string, unknown>;
};

export type TaskGroupPayloadMap = {
  chat:
    | {
        kind: "conversation";
        threadId: string | null;
        promptMode: string;
        contextLength?: number;
        userMessage: MessagePart[];
        continuationIndex?: number;
        carryoverText?: string;
        carryoverReasoning?: string;
        tasks?: Task[];
      }
    | {
        kind: "generate_title";
        threadId: string;
        contextLength?: number;
        tasks?: Task[];
      }
    | {
        kind: "collapse_context";
        threadId: string;
        promptMode: string;
        contextLength?: number;
        interruption?: {
          interrupted: boolean;
          interruptedAssistantTailChars?: string;
          interruptedAssistantFullText?: string;
          interruptionContext?: string;
        };
        tasks?: Task[];
      };
  comfy: {
    workflowName: string;
    prompt: string;
    negativePrompt: string;
    inputImage: string[];
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
    tasks?: Task[];
  };
};

export type TaskGroupResultMap = {
  chat: {
    text?: string;
    reasoning?: string;
    responseId?: string | null;
    summaryCallsInCurrentRequest?: number;
    delegatedToTaskGroupId?: string;
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

export type BaseTaskGroup<TType extends TaskGroupType = TaskGroupType> = {
  id: string;
  type: TType;
  status: TaskGroupStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  payload: TaskGroupPayloadMap[TType];
  result: TaskGroupResultMap[TType] | null;
};

export type TaskGroup = BaseTaskGroup<"chat"> | BaseTaskGroup<"comfy">;

export type TaskQueueSnapshot = {
  chat: TaskGroup[];
  comfy: TaskGroup[];
};

export type GpuMode = "chat" | "comfy" | "switching";

export type SchedulerSnapshot = {
  gpuMode: GpuMode;
  activeTaskId: string | null;
  queues: TaskQueueSnapshot;
};

export type TaskEventMap = {
  "task:queued": { task: TaskGroup };
  "task:started": { task: TaskGroup };
  "task:updated": { task: TaskGroup };
  "task:completed": { task: TaskGroup };
  "task:failed": { task: TaskGroup };
  "task:cancelled": { task: TaskGroup };
  "queue:changed": SchedulerSnapshot;
  "gpu:changed": SchedulerSnapshot;
};
