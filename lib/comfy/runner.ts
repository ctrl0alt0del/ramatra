import { Client, outToB64Urls, Workflow } from "@stable-canvas/comfyui-client";
import {
  createGeneration,
  markGenerationFailed,
  storeCompletedGeneration,
  updateGenerationProgress,
} from "./generations";
import { buildQuickChromaWorkflow } from "./workflows/quickChroma";

const workflows: Record<string, (input: WorkflowInput) => Workflow> = {
  quick_chroma: buildQuickChromaWorkflow,
};
type WorkflowInput = object;

export enum ComfyJobStatus {
  Queued = "queued",
  Running = "running",
  Completed = "completed",
  Failed = "failed",
}

type IRunnerOptions = {
  client: Client;
  workflowName: string;
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
  console.log("Running workflow", workflowName, "with input", input);
  const workflowBuilder = workflows[workflowName];
  if (!workflowBuilder) {
    throw new Error(`Workflow ${workflowName} not found`);
  }
  const workflow = workflowBuilder(input);
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

  const removeProgressListener = client.on_progress((progress) => {
    updateGenerationProgress({
      jobId: job.task_id!,
      value: progress.value,
      max: progress.max,
      node: progress.node,
    });
  }, job.task_id);

  const cleanup = () => {
    removeProgressListener();
    removeExecutionError();
    removeExecutionInterrupted();
    removeExecutionSuccess();
  };

  const removeExecutionError = client.on("execution_error", (event) => {
    if (event.prompt_id !== job.task_id) return;
    markGenerationFailed(job.task_id!, event.exception_message);
    cleanup();
  });

  const removeExecutionInterrupted = client.on("execution_interrupted", (event) => {
    if (event.prompt_id !== job.task_id) return;
    markGenerationFailed(job.task_id!, "Generation was interrupted");
    cleanup();
  });

  const removeExecutionSuccess = client.on("execution_success", (event) => {
    if (event.prompt_id !== job.task_id) return;
    cleanup();
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
  const base64Urls = await outToB64Urls(result);

  const images = base64Urls.map((dataUrl) => {
    const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!match) {
      throw new Error("Invalid data URL");
    }

    return {
      mimeType: match[1],
      data: match[2],
    };
  });

  storeCompletedGeneration({
    jobId,
    images,
  });

  return {
    jobId,
    status: ComfyJobStatus.Completed,
    images,
  };
}
