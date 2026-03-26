import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerGenerateImageMcpTool } from "@/lib/tools/generate-image";
import { registerListLorasMcpTool } from "@/lib/tools/list-loras";
import { registerSearchCivitaiLorasMcpTool } from "@/lib/tools/search-civitai-loras";

import { bootstrapExpressServerForMCPServer } from "../bootstrap";

function createComfyFullMCPServer() {
  const comfyServer = new McpServer({
    name: "comfy-mcp-full",
    version: "0.1.0",
  });

  registerGenerateImageMcpTool(comfyServer);
  registerListLorasMcpTool(comfyServer);
  registerSearchCivitaiLorasMcpTool(comfyServer);

  return comfyServer;
}

function createComfyReadOnlyMCPServer() {
  const comfyServer = new McpServer({
    name: "comfy-mcp-readonly",
    version: "0.1.0",
  });

  registerListLorasMcpTool(comfyServer);
  registerSearchCivitaiLorasMcpTool(comfyServer);

  return comfyServer;
}

bootstrapExpressServerForMCPServer(
  process.env.COMFY_MCP_PORT ? parseInt(process.env.COMFY_MCP_PORT) : 4000,
  createComfyFullMCPServer,
);

bootstrapExpressServerForMCPServer(
  process.env.COMFY_MCP_READONLY_PORT
    ? parseInt(process.env.COMFY_MCP_READONLY_PORT)
    : 4001,
  createComfyReadOnlyMCPServer,
);
