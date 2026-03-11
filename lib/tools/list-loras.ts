import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listAvailableLoras } from "@/lib/comfy/loras";

export const listLorasToolName = "list_available_loras";

const listLorasInputSchema = z.object({
  query: z.string().optional(),
  limit: z.number().int().positive().max(200).default(50),
});

export const registerListLorasMcpTool = (server: McpServer) => {
  server.registerTool(
    listLorasToolName,
    {
      title: "List Available LoRAs",
      description:
        "Scans the configured LoRA directory, returns available LoRAs, their relative names, base-model metadata, and tag-frequency concepts.",
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
