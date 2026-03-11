import { tool, type Tool } from "@lmstudio/sdk";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { encodeComfyJobMarker } from "@/components/chat/comfy-marker";
import { getClient } from "@/lib/comfy/client";
import { validateRequestedLoras } from "@/lib/comfy/loras";
import { runWorkflow } from "@/lib/comfy/runner";
import { workflowNames } from "@/lib/comfy/workflows/types";

export const generateImageToolName = "generate_image";
export const generateImageToolTitle = "Generate Image";
export const generateImageToolDescription =
  "Starts an image generation job in ComfyUI for the selected workflow and returns a queued job marker. Before the first image generation in a conversation, list_available_loras should normally be called so LoRAs can be preferred when they directly match the requested concept. Start with sampler euler, scheduler simple, and steps 25 by default. In loras[].name, use the exact file name or relative path returned by list_available_loras. Do not automatically retry after a failed generate_image call.";

export const generateImageParameters = {
  workflowName: z.enum(workflowNames).default("base"),
  prompt: z.string().min(1, "Prompt cannot be empty"),
  negativePrompt: z.string().default(""),
  steps: z.number().int().positive().max(1000).default(25),
  width: z.number().int().positive().max(2048).default(512),
  height: z.number().int().positive().max(2048).default(512),
  cfg: z.number().positive().max(3.5).default(1),
  seed: z
    .number()
    .int()
    .positive()
    .default(() => Math.floor(Math.random() * 1000000)),
  samplerName: z.string().default("euler"),
  scheduler: z.string().default("simple"),
  loras: z
    .array(
      z.object({
        name: z.string().min(1, "LoRA file name or relative path cannot be empty"),
        strength_model: z.number(),
        strength_clip: z.number(),
      }),
    )
    .default([]),
};

export const generateImageInputSchema = z.object(generateImageParameters);

export type GenerateImageInput = z.infer<typeof generateImageInputSchema>;

export type GenerateImageResult =
  | {
      ok: true;
      workflowName: string;
      jobId: string;
      status: "queued" | "running";
      marker: string;
    }
  | {
      ok: false;
      error: string;
    };

export const executeGenerateImage = async (
  input: GenerateImageInput,
): Promise<GenerateImageResult> => {
  const {
    workflowName,
    prompt,
    negativePrompt,
    steps,
    width,
    height,
    cfg,
    seed,
    samplerName,
    scheduler,
    loras,
  } = input;

  try {
    const validatedLoras = await validateRequestedLoras(loras);
    if (!validatedLoras.ok) {
      return {
        ok: false,
        error: validatedLoras.error,
      };
    }

    const result = await runWorkflow({
      client: await getClient(),
      workflowName,
      input: {
        positivePrompt: prompt,
        negativePrompt,
        steps,
        width,
        height,
        cfg,
        seed,
        samplerName,
        scheduler,
        loras: validatedLoras.resolved,
      },
    });

    if (!("jobId" in result)) {
      return {
        ok: false,
        error: "Image generation failed before queueing.",
      };
    }

    return {
      ok: true,
      workflowName,
      jobId: result.jobId,
      status: result.status,
      marker: encodeComfyJobMarker({
        jobId: result.jobId,
        status: result.status,
        workflowName,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error: `Image generation failed to start: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    };
  }
};

export const getGenerateImageOpenAIToolSpec = () => ({
  type: "function" as const,
  function: {
    name: generateImageToolName,
    description:
      "Use this whenever the user asks to create, generate, render, draw, or make an image. Choose the workflowName explicitly. Default to workflowName 'base' for most requests, pass cfg 1 unless stronger prompt adherence is truly needed, and provide any LoRAs that should be applied. Before the first image generation in a conversation, call list_available_loras unless the LoRA inventory was already checked and is still relevant. Prefer LoRAs whenever they directly match the requested concept, subject, style, or tags. Start with samplerName 'euler', scheduler 'simple', and steps 25. If higher quality is requested, switch next to samplerName 'res_2s' and scheduler 'beta57'. Only then should you increase steps. In loras[].name, use the exact file name or relative path returned by list_available_loras. If the tool call fails, do not automatically call generate_image again.",
    parameters: z.toJSONSchema(generateImageInputSchema),
  },
});

export const parseGenerateImageArguments = (rawArguments: string) => {
  const parsed = JSON.parse(rawArguments) as unknown;
  return generateImageInputSchema.parse(parsed);
};

export const createGenerateImageLmStudioTool = (
  onResult?: (result: GenerateImageResult) => void,
): Tool =>
  tool({
    name: generateImageToolName,
    description: generateImageToolDescription,
    parameters: generateImageParameters,
    implementation: async (input, ctx) => {
      console.log("Executing generate image tool with input:", input);
      const result = await executeGenerateImage(input);
      onResult?.(result);

      if (result.ok) {
        ctx.status(`Queued ComfyUI job ${result.jobId}`);
      } else {
        ctx.status("Image generation failed");
      }

      return result;
    },
  });

export const registerGenerateImageMcpTool = (server: McpServer) => {
  server.registerTool(
    generateImageToolName,
    {
      title: generateImageToolTitle,
      description:
        "Starts an image generation job in ComfyUI for the selected workflow and returns a job marker that must be preserved verbatim in the assistant response. Default to workflowName 'base' for most requests and keep cfg at 1 unless a small increase is clearly needed. Before the first image generation in a conversation, list_available_loras should normally be called first, and LoRAs should be preferred when they directly match the requested concept or tags. Start with sampler euler, scheduler simple, and steps 25. If more quality is needed, switch next to res_2s and beta57, then increase steps only if needed after that. In loras[].name, use the exact file name or relative path returned by list_available_loras. If the tool call fails, do not automatically call generate_image again.",
      inputSchema: generateImageInputSchema,
    },
    async (input) => {
      const result = await executeGenerateImage(input);

      return {
        content: [
          {
            type: "text",
            text: result.ok
              ? "Generation started. Include the marker below exactly once and verbatim in your final response.\n\n" +
                result.marker
              : result.error,
          },
        ],
      };
    },
  );
};
