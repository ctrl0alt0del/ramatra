import { Client, outToB64Urls, Workflow } from "@stable-canvas/comfyui-client";
import { buildQuickChromaWorkflow } from "./workflows/quickChroma";

const workflows: Record<string, (input: any) => Workflow> = {
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
    }
  | {
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
  return {
    jobId: job.task_id,
    status: ComfyJobStatus.Queued,
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
    };
  }

  if (status.running) {
    return {
      jobId,
      status: ComfyJobStatus.Running,
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

  return {
    jobId,
    status: ComfyJobStatus.Completed,
    images,
  };
}
