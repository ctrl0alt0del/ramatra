import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGenerateImageMcpTool } from "@/lib/tools/generate-image";
import { registerListLorasMcpTool } from "@/lib/tools/list-loras";

import { bootstrapExpressServerForMCPServer } from "../bootstrap";

function createComfyMCPServer() {
  const comfyServer = new McpServer({
    name: "comfy-mcp",
    version: "0.1.0",
  });

  registerGenerateImageMcpTool(comfyServer);
  registerListLorasMcpTool(comfyServer);

  return comfyServer;
}

bootstrapExpressServerForMCPServer(
  process.env.COMFY_MCP_PORT ? parseInt(process.env.COMFY_MCP_PORT) : 4000,
  createComfyMCPServer,
);
