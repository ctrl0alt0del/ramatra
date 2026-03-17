import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listAvailableLoras } from "@/lib/comfy/loras";
import { workflowNames } from "@/lib/comfy/workflows/types";

export const listLorasToolName = "list_available_loras";

const listLorasInputSchema = z.object({
  workflowName: z.enum(workflowNames).optional(),
  concepts: z.array(z.string()).optional(),
});

export const registerListLorasMcpTool = (server: McpServer) => {
  server.registerTool(
    listLorasToolName,
    {
      title: "List Available LoRAs",
      description:
        "Lists available LoRA files from configured ComfyUI LoRA directories.",
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
