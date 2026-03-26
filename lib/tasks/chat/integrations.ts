import type { PromptMode } from "@/lib/lmstudio/prompt-modes";

export type IntegrationServerLabel =
  | "comfy"
  | "comfy_readonly"
  | "web_search"
  | "civitai"
  | "memory";

export type EphemeralMcpIntegration = {
  type: "ephemeral_mcp";
  server_label: IntegrationServerLabel;
  server_url: string;
  allowed_tools?: string[];
};

const getComfyMcpUrl = () => {
  const explicitUrl = process.env.COMFY_MCP_URL;
  if (explicitUrl) {
    return explicitUrl;
  }

  const port = process.env.COMFY_MCP_PORT ?? "4000";
  return `http://127.0.0.1:${port}/mcp`;
};

const getComfyReadOnlyMcpUrl = () => {
  const explicitUrl = process.env.COMFY_MCP_READONLY_URL;
  if (explicitUrl) {
    return explicitUrl;
  }

  const port = process.env.COMFY_MCP_READONLY_PORT ?? "4001";
  return `http://127.0.0.1:${port}/mcp`;
};

const canUseMemoryForMode = (promptMode: PromptMode | string | null | undefined) => {
  return promptMode === "writer" || promptMode === "roleplay";
};

const getMemoryMcpUrl = () => {
  const explicitUrl = process.env.MEMORY_MCP_URL;
  if (explicitUrl) {
    return explicitUrl;
  }

  const port = process.env.MEMORY_MCP_PORT ?? "9558";
  return `http://127.0.0.1:${port}/mcp`;
};

export const buildIntegrationsForServers = (
  servers: IntegrationServerLabel[],
  options?: {
    promptMode?: PromptMode | string | null;
  },
): EphemeralMcpIntegration[] => {
  const integrations: EphemeralMcpIntegration[] = [];

  if (
    servers.includes("web_search") &&
    process.env.WEB_SEARCH_MCP_ENABLED === "true"
  ) {
    const serverUrl = process.env.WEB_SEARCH_MCP_URL;
    if (serverUrl) {
      integrations.push({
        type: "ephemeral_mcp",
        server_label: "web_search",
        server_url: serverUrl,
      });
    }
  }

  if (servers.includes("comfy")) {
    integrations.push({
      type: "ephemeral_mcp",
      server_label: "comfy",
      server_url: getComfyMcpUrl(),
    });
  }

  if (servers.includes("comfy_readonly")) {
    integrations.push({
      type: "ephemeral_mcp",
      server_label: "comfy_readonly",
      server_url: getComfyReadOnlyMcpUrl(),
    });
  }

  if (servers.includes("civitai")) {
    const serverUrl = process.env.CIVITAI_MCP_URL;
    const civitaiEnabled = process.env.CIVITAI_MCP_ENABLED;
    if (serverUrl && civitaiEnabled !== "false") {
      integrations.push({
        type: "ephemeral_mcp",
        server_label: "civitai",
        server_url: serverUrl,
      });
    }
  }

  if (
    servers.includes("memory") &&
    process.env.MEMORY_MCP_ENABLED === "true" &&
    canUseMemoryForMode(options?.promptMode)
  ) {
    integrations.push({
      type: "ephemeral_mcp",
      server_label: "memory",
      server_url: getMemoryMcpUrl(),
    });
  }

  return integrations;
};

export const buildIntegrations = (
  promptMode: PromptMode,
): EphemeralMcpIntegration[] => {
  if (promptMode === "regular") {
    return buildIntegrationsForServers(["web_search"], { promptMode });
  }

  if (promptMode === "writer") {
    return buildIntegrationsForServers(["web_search", "memory"], {
      promptMode,
    });
  }

  if (promptMode === "roleplay") {
    return buildIntegrationsForServers(["memory"], { promptMode });
  }

  if (promptMode === "artist") {
    // Keep the root Artist turn tool-free so it can emit routing markers
    // instead of calling tools directly. Util tasks can re-enable tools.
    return [];
  }

  return [];
};
