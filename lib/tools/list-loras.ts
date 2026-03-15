import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listAvailableLoras } from "@/lib/comfy/loras";
import { workflowNames } from "@/lib/comfy/workflows/types";

export const listLorasToolName = "list_available_loras";

const listLorasInputSchema = z.object({
  query: z.string().optional(),
  workflowName: z.enum(workflowNames).optional(),
  limit: z.number().int().positive().max(200).default(50),
});

export const registerListLorasMcpTool = (server: McpServer) => {
  server.registerTool(
    listLorasToolName,
    {
      title: "List Available LoRAs",
      description:
        "Scans configured LoRA subfolders and returns available LoRA names (including subfolder path and extension). Optionally pass workflowName to restrict results by workflow folder mapping: base->chroma/, edit->qwen/, illustration->illustration/ and illustr_style/. Use this before the first image generation in a conversation so matching LoRAs can be preferred for the requested concept.",
      inputSchema: listLorasInputSchema,
    },
    async (input) => {
      try {
        const result = await listAvailableLoras(input);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text:
                error instanceof Error
                  ? error.message
                  : "Failed to list available LoRAs.",
            },
          ],
          isError: true,
        };
      }
    },
  );
};


