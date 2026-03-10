import { getClient } from "@/lib/comfy/client";
import {
  ComfyJobStatus,
  getWorkflowStatus,
  runWorkflow,
} from "@/lib/comfy/runner";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { bootstrapExpressServerForMCPServer } from "../bootstrap";
const generateImageInput = {
  prompt: z.string().min(1, "Prompt cannot be empty"),
  negativePrompt: z.string().optional(),
  steps: z.number().int().positive().max(1000).default(50),
  width: z.number().int().positive().max(2048).default(512),
  height: z.number().int().positive().max(2048).default(512),
  cfg: z.number().positive().max(20).default(7),
  seed: z
    .number()
    .int()
    .positive()
    .default(() => Math.floor(Math.random() * 1000000)),
  samplerName: z.string().default("euler"),
  scheduler: z.string().default("simple"),
};

function createComfyMCPServer() {
  const comfyServer = new McpServer({
    name: "comfy-mcp",
    version: "0.1.0",
  });

  comfyServer.registerTool(
    "generate_image",
    {
      title: "Generate Image",
      description:
        "Starts an image generation job and returns a jobId. Call get_image_result afterward to retrieve the final image.",
      inputSchema: z.object(generateImageInput),
    },
    async (input) => {
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

      return {
        content: [
          {
            type: "text",
            text: `Workflow run status (JSON stringified): ${JSON.stringify(result)}`,
          },
        ],
      };
    },
  );
  comfyServer.registerTool(
    "get_image_result",
    {
      title: "Get Image Result",
      description:
        "Checks a generation job by jobId and returns its status or final image when ready.",
      inputSchema: z.object({
        jobId: z.string().min(1, "jobId is required"),
      }),
    },
    async ({ jobId }) => {
      const result = await getWorkflowStatus(await getClient(), jobId);

      if (result.status === ComfyJobStatus.Completed) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                jobId: result.jobId,
                status: result.status,
                imageCount: result.images.length,
              }),
            },
            ...result.images.map((image) => ({
              type: "image" as const,
              data: image.data,
              mimeType: image.mimeType,
            })),
          ],
        };
      }

      if (result.status === ComfyJobStatus.Failed) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                jobId: jobId,
                status: result.status,
                error: "Error message to be implemented",
              }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              jobId: result.jobId,
              status: result.status,
            }),
          },
        ],
      };
    },
  );

  return comfyServer;
}

bootstrapExpressServerForMCPServer(
  process.env.COMFY_MCP_PORT ? parseInt(process.env.COMFY_MCP_PORT) : 4000,
  createComfyMCPServer,
);
