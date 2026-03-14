import { getClient } from "@/lib/comfy/client";
import { runWorkflow } from "@/lib/comfy/runner";
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
    const results = await runWorkflow({
      client: await getClient(),
      workflowName,
      input: workflowInput,
    });
    const responseBody = {
      images: {
        base64Array: results,
      },
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
