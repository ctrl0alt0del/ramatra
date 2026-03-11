import { tool, type Tool } from "@lmstudio/sdk";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { encodeComfyJobMarker } from "@/components/chat/comfy-marker";
import { getClient } from "@/lib/comfy/client";
import { runWorkflow } from "@/lib/comfy/runner";

export const generateImageToolName = "generate_image";
export const generateImageToolTitle = "Generate Image";
export const generateImageToolDescription =
  "Starts an image generation job in ComfyUI and returns a queued job marker.";

export const generateImageParameters = {
  prompt: z.string().min(1, "Prompt cannot be empty"),
  negativePrompt: z.string().optional(),
  steps: z.number().int().positive().max(1000).default(50),
  width: z.number().int().positive().max(2048).default(512),
  height: z.number().int().positive().max(2048).default(512),
  cfg: z.number().positive().max(20).default(2),
  seed: z
    .number()
    .int()
    .positive()
    .default(() => Math.floor(Math.random() * 1000000)),
  samplerName: z.string().default("res_2s"),
  scheduler: z.string().default("beta57"),
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
    prompt,
    negativePrompt,
    steps,
    width,
    height,
    cfg,
    seed,
    samplerName,
    scheduler,
  } = input;

  try {
    const result = await runWorkflow({
      client: await getClient(),
      workflowName: "quick_chroma",
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
      workflowName: "quick_chroma",
      jobId: result.jobId,
      status: result.status,
      marker: encodeComfyJobMarker({
        jobId: result.jobId,
        status: result.status,
        workflowName: "quick_chroma",
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
      "Use this whenever the user asks to create, generate, render, draw, or make an image. Do not answer with text alone for image-generation requests.",
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
        "Starts an image generation job in ComfyUI and returns a job marker that must be preserved verbatim in the assistant response.",
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
