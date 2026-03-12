import { Client, outToB64Urls, Workflow } from "@stable-canvas/comfyui-client";
import {
  createGeneration,
  markGenerationFailed,
  storeCompletedGeneration,
  updateGenerationProgress,
} from "./generations";
import { getSchedulerState, updateComfyTaskForJob } from "@/lib/tasks/scheduler";
import { buildBaseWorkflow } from "./workflows/base";
import { buildQuickChromaWorkflow } from "./workflows/quickChroma";
import { type WorkflowInput, type WorkflowName } from "./workflows/types";

const workflows: Record<WorkflowName, (input: WorkflowInput) => Workflow> = {
  base: buildBaseWorkflow,
  quick_chroma: buildQuickChromaWorkflow,
};

const getNodeProgressRatio = (value: number | null, max: number | null) => {
  if (value === null || max === null || max <= 0) return 0;
  return Math.max(0, Math.min(1, value / max));
};

const isCompletedProgressState = (state: string | null | undefined) => {
  const normalized = state?.trim().toLowerCase() ?? "";
  return (
    normalized.includes("complete") ||
    normalized.includes("executed") ||
    normalized.includes("cached") ||
    normalized.includes("success") ||
    normalized.includes("done")
  );
};

const isActiveProgressState = (state: string | null | undefined) => {
  const normalized = state?.trim().toLowerCase() ?? "";
  return (
    normalized.includes("running") ||
    normalized.includes("executing") ||
    normalized.includes("progress")
  );
};

const countWorkflowNodes = (workflow: Workflow) => {
  const definition = workflow.workflow() as {
    prompt?: Record<string, unknown>;
  };

  return Object.keys(definition.prompt ?? {}).length;
};

const getWorkflowProgressPercentage = ({
  totalNodes,
  completedNodeCount,
  currentNodeProgressRatio,
}: {
  totalNodes: number;
  completedNodeCount: number;
  currentNodeProgressRatio: number;
}) => {
  if (totalNodes <= 0) {
    return null;
  }

  const rawProgress =
    ((completedNodeCount + currentNodeProgressRatio) / totalNodes) * 100;

  return Math.max(0, Math.min(100, Math.round(rawProgress)));
};

const getWorkflowProgressFromProgressState = ({
  nodes,
  completedNodes,
  currentNodeId,
  totalNodesFallback,
}: {
  nodes: Record<
    string,
    {
      value: number;
      max: number;
      state: string;
      node_id: string;
      display_node_id: string;
      real_node_id: string;
    }
  >;
  completedNodes: Set<string>;
  currentNodeId: string | null;
  totalNodesFallback: number;
}) => {
  const nodeEntries = Object.values(nodes);
  const totalNodes = Math.max(totalNodesFallback, nodeEntries.length);
  if (totalNodes <= 0) {
    return {
      percentage: null,
      activeNode: null as
        | {
            value: number | null;
            max: number | null;
            node: string | null;
            progressRatio: number;
          }
        | null,
    };
  }

  let completedCount = 0;
  let activeNode: {
    value: number | null;
    max: number | null;
    node: string | null;
    progressRatio: number;
  } | null = null;

  for (const node of nodeEntries) {
    const nodeId = node.real_node_id || node.node_id;
    if (completedNodes.has(nodeId) || isCompletedProgressState(node.state)) {
      completedCount += 1;
      continue;
    }

    const progressRatio = getNodeProgressRatio(node.value, node.max);
    const isActive =
      currentNodeId === node.display_node_id ||
      currentNodeId === node.node_id ||
      currentNodeId === node.real_node_id ||
      isActiveProgressState(node.state) ||
      (progressRatio > 0 && progressRatio < 1);

    if (!activeNode && isActive) {
      activeNode = {
        value: node.value,
        max: node.max,
        node: node.display_node_id || node.node_id || node.real_node_id || null,
        progressRatio,
      };
    }
  }

  const percentage = getWorkflowProgressPercentage({
    totalNodes,
    completedNodeCount: completedCount,
    currentNodeProgressRatio: activeNode?.progressRatio ?? 0,
  });

  return {
    percentage,
    activeNode,
  };
};

const extractImagesFromPromptResult = async (result: Awaited<ReturnType<Client["getPromptResult"]>>) => {
  const base64Urls = await outToB64Urls(result);

  return base64Urls.map((dataUrl) => {
    const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!match) {
      throw new Error("Invalid data URL");
    }

    return {
      mimeType: match[1],
      data: match[2],
    };
  });
};

const finalizeComfyTaskCycle = async () => {
  const snapshot = getSchedulerState();
  const hasQueuedChatTasks = snapshot.queues.chat.some((task) => task.status === "queued");
  const hasQueuedComfyTasks = snapshot.queues.comfy.some((task) => task.status === "queued");

  if (hasQueuedChatTasks || !hasQueuedComfyTasks) {
    const { switchToChatGpuMode } = await import("@/lib/tasks/gpu-manager");
    await switchToChatGpuMode();
  }

  const { processTaskQueues } = await import("@/lib/tasks/processor");
  await processTaskQueues();
};

export enum ComfyJobStatus {
  Queued = "queued",
  Running = "running",
  Completed = "completed",
  Failed = "failed",
}

type IRunnerOptions = {
  client: Client;
  workflowName: WorkflowName;
  input: WorkflowInput;
};

type IWorkflowRun =
  | {
      jobId: string;
      status: ComfyJobStatus.Queued | ComfyJobStatus.Running;
      progress?: {
        value: number | null;
        max: number | null;
        percentage: number | null;
        node: string | null;
      };
    }
  | {
      jobId?: string;
      status: ComfyJobStatus.Failed;
    }
  | {
      jobId: string;
      status: ComfyJobStatus.Completed;
      images: {
        mimeType: string;
        data: string; //base64 without data URL prefix
      }[];
    };

export async function runWorkflow({
  client,
  workflowName,
  input,
}: IRunnerOptions): Promise<IWorkflowRun> {
  const workflowBuilder = workflows[workflowName];
  if (!workflowBuilder) {
    throw new Error(`Workflow ${workflowName} not found`);
  }
  const workflow = workflowBuilder(input);
  const workflowNodeTotal = countWorkflowNodes(workflow);
  const job = workflow.instance(client);
  await job.enqueue();
  if (!job.task_id) {
    return {
      status: ComfyJobStatus.Failed,
    };
  }

  createGeneration({
    jobId: job.task_id,
    workflowName,
    status: ComfyJobStatus.Queued,
  });

  const completedNodes = new Set<string>();
  let currentNodeId: string | null = null;
  let currentNodeProgressRatio = 0;
  let highestWorkflowPercentage = 0;

  const publishWorkflowProgress = (input: {
    node: string | null;
    value: number | null;
    max: number | null;
    percentage?: number | null;
  }) => {
    const rawWorkflowPercentage =
      input.percentage ??
      getWorkflowProgressPercentage({
        totalNodes: workflowNodeTotal,
        completedNodeCount: completedNodes.size,
        currentNodeProgressRatio,
      });
    const workflowPercentage =
      rawWorkflowPercentage === null
        ? null
        : Math.max(highestWorkflowPercentage, rawWorkflowPercentage);

    if (workflowPercentage !== null) {
      highestWorkflowPercentage = workflowPercentage;
    }

    updateGenerationProgress({
      jobId: job.task_id!,
      value: input.value,
      max: input.max,
      node: input.node,
    });
    updateComfyTaskForJob(job.task_id!, {
      status: ComfyJobStatus.Running,
      progress: {
        value: input.value,
        max: input.max,
        percentage: workflowPercentage,
        node: input.node,
      },
    });
  };

  const removeProgressListener = client.on_progress((progress) => {
    currentNodeId = progress.node ?? null;
    currentNodeProgressRatio = getNodeProgressRatio(progress.value, progress.max);
    publishWorkflowProgress({
      node: progress.node ?? null,
      value: progress.value,
      max: progress.max,
    });
  }, job.task_id);

  const removeProgressStateListener = client.on("progress_state", (event) => {
    if (event.prompt_id !== job.task_id) return;

    const progressState = getWorkflowProgressFromProgressState({
      nodes: event.nodes,
      completedNodes,
      currentNodeId,
      totalNodesFallback: workflowNodeTotal,
    });

    currentNodeProgressRatio = progressState.activeNode?.progressRatio ?? 0;
    if (progressState.activeNode?.node) {
      currentNodeId = progressState.activeNode.node;
    }

    publishWorkflowProgress({
      node: progressState.activeNode?.node ?? currentNodeId,
      value: progressState.activeNode?.value ?? null,
      max: progressState.activeNode?.max ?? null,
      percentage: progressState.percentage,
    });
  });

  const removeExecutingListener = client.on("executing", (event) => {
    if (event.prompt_id !== job.task_id) return;

    if (currentNodeId && event.node && currentNodeId !== event.node) {
      completedNodes.add(currentNodeId);
    }

    currentNodeId = event.node ?? null;
    currentNodeProgressRatio = 0;
    publishWorkflowProgress({
      node: event.node ?? null,
      value: null,
      max: null,
    });
  });

  const markNodeCompleted = (nodeId: string | null | undefined) => {
    if (!nodeId) return;
    completedNodes.add(nodeId);
    if (currentNodeId === nodeId) {
      currentNodeProgressRatio = 0;
    }
  };

  const removeExecutedListener = client.on("executed", (event) => {
    if (event.prompt_id !== job.task_id) return;
    markNodeCompleted(event.node);
    publishWorkflowProgress({
      node: currentNodeId === event.node ? null : currentNodeId,
      value: null,
      max: null,
    });
  });

  const removeExecutionCachedListener = client.on("execution_cached", (event) => {
    if (event.prompt_id !== job.task_id) return;
    for (const nodeId of event.nodes) {
      markNodeCompleted(nodeId);
    }
    publishWorkflowProgress({
      node: currentNodeId,
      value: null,
      max: null,
    });
  });

  const cleanup = () => {
    removeProgressListener();
    removeProgressStateListener();
    removeExecutingListener();
    removeExecutedListener();
    removeExecutionCachedListener();
    removeExecutionError();
    removeExecutionInterrupted();
    removeExecutionSuccess();
  };

  const removeExecutionError = client.on("execution_error", (event) => {
    if (event.prompt_id !== job.task_id) return;
    markGenerationFailed(job.task_id!, event.exception_message);
    updateComfyTaskForJob(job.task_id!, {
      status: ComfyJobStatus.Failed,
      error: event.exception_message,
    });
    cleanup();
    void finalizeComfyTaskCycle();
  });

  const removeExecutionInterrupted = client.on(
    "execution_interrupted",
    (event) => {
      if (event.prompt_id !== job.task_id) return;
      markGenerationFailed(job.task_id!, "Generation was interrupted");
      updateComfyTaskForJob(job.task_id!, {
        status: ComfyJobStatus.Failed,
        error: "Generation was interrupted",
      });
      cleanup();
      void finalizeComfyTaskCycle();
    },
  );

  const removeExecutionSuccess = client.on("execution_success", async (event) => {
    if (event.prompt_id !== job.task_id) return;
    try {
      const result = await client.getPromptResult(job.task_id!);
      const images = await extractImagesFromPromptResult(result);
      storeCompletedGeneration({
        jobId: job.task_id!,
        workflowName,
        images,
      });
      highestWorkflowPercentage = 100;
      updateComfyTaskForJob(job.task_id!, {
        status: ComfyJobStatus.Completed,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to store completed generation";
      markGenerationFailed(job.task_id!, message);
      updateComfyTaskForJob(job.task_id!, {
        status: ComfyJobStatus.Failed,
        error: message,
      });
    }
    cleanup();
    void finalizeComfyTaskCycle();
  });

  return {
    jobId: job.task_id,
    status: ComfyJobStatus.Queued,
    progress: {
      value: null,
      max: null,
      percentage: null,
      node: null,
    },
  };
}

export async function getWorkflowStatus(
  client: Client,
  jobId: string,
): Promise<IWorkflowRun> {
  const status = await client.getPromptStatus(jobId);

  if (status.pending) {
    return {
      jobId,
      status: ComfyJobStatus.Queued,
      progress: {
        value: null,
        max: null,
        percentage: null,
        node: null,
      },
    };
  }

  if (status.running) {
    return {
      jobId,
      status: ComfyJobStatus.Running,
      progress: {
        value: null,
        max: null,
        percentage: null,
        node: null,
      },
    };
  }

  if (!status.done) {
    return {
      status: ComfyJobStatus.Failed,
    };
  }
  const result = await client.getPromptResult(jobId);
  const images = await extractImagesFromPromptResult(result);

  storeCompletedGeneration({
    jobId,
    images,
  });
  updateComfyTaskForJob(jobId, {
    status: ComfyJobStatus.Completed,
  });
  void finalizeComfyTaskCycle();

  return {
    jobId,
    status: ComfyJobStatus.Completed,
    images,
  };
}
