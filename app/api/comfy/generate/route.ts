import { getClient } from "@/lib/comfy/client";
import { upsertDirectComfyHistory } from "@/lib/comfy/direct-studio-history";
import { ensureComfyQueueListeners } from "@/lib/tasks/comfy-runner";
import { processTaskQueues } from "@/lib/tasks/processor";
import { enqueueComfyTask } from "@/lib/tasks/scheduler";
import { workflowNames } from "@/lib/comfy/workflows/types";
import { toHttpError } from "@/lib/errors/server-error";
import z from "zod";

const loraSchema = z.object({
  name: z.string(),
  strength_model: z.number(),
  strength_clip: z.number(),
});

const workflowInputSchema = z.object({
  positivePrompt: z.string(),
  negativePrompt: z.string(),
  inputImage: z.array(z.string()).default([]),
  width: z.number(),
  height: z.number(),
  steps: z.number(),
  cfg: z.number(),
  seed: z.number(),
  samplerName: z.string(),
  scheduler: z.string(),
  loras: z.array(loraSchema),
});

const generateSchema = z.object({
  workflowName: z.enum(workflowNames),
  input: workflowInputSchema,
});

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const parsed = generateSchema.safeParse(json);

    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const input = parsed.data;
    const workflowName = input.workflowName;
    const workflowInput = input.input;

    await getClient();

    const task = enqueueComfyTask({
      sourceThreadId: null,
      sourceUserIntent: workflowInput.positivePrompt,
      workflowName,
      prompt: workflowInput.positivePrompt,
      negativePrompt: workflowInput.negativePrompt,
      inputImage: workflowInput.inputImage,
      width: workflowInput.width,
      height: workflowInput.height,
      steps: workflowInput.steps,
      cfg: workflowInput.cfg,
      seed: workflowInput.seed,
      samplerName: workflowInput.samplerName,
      scheduler: workflowInput.scheduler,
      loras: workflowInput.loras,
    });

    upsertDirectComfyHistory({
      taskId: task.id,
      params: {
        workflowName,
        prompt: workflowInput.positivePrompt,
        negativePrompt: workflowInput.negativePrompt,
        inputImage: workflowInput.inputImage,
        width: workflowInput.width,
        height: workflowInput.height,
        steps: workflowInput.steps,
        cfg: workflowInput.cfg,
        seed: workflowInput.seed,
        samplerName: workflowInput.samplerName,
        scheduler: workflowInput.scheduler,
        loras: workflowInput.loras,
      },
    });

    ensureComfyQueueListeners();
    void processTaskQueues();

    const responseBody = {
      taskId: task.id,
      status: "queued" as const,
      jobId: null as string | null,
    };

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in /api/comfy/generate:", error);
    const httpErrorData = toHttpError(error);
    return new Response(httpErrorData.body, {
      status: httpErrorData.status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
