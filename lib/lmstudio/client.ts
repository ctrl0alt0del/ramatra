import { LMStudioClient } from "@lmstudio/sdk";

declare global {
  var __comfyBridgeLmStudioClient: LMStudioClient | undefined;
}

const getLMStudioSdkBaseUrl = () => {
  const explicitUrl =
    process.env.LM_STUDIO_SDK_BASE_URL ?? process.env.LM_STUDIO_WS_URL;

  if (explicitUrl) {
    return explicitUrl;
  }

  const rawBaseUrl = process.env.LM_STUDIO_BASE_URL;
  if (!rawBaseUrl) {
    return undefined;
  }

  const normalizedUrl = new URL(rawBaseUrl);
  normalizedUrl.protocol =
    normalizedUrl.protocol === "https:" ? "wss:" : "ws:";

  if (normalizedUrl.pathname === "/v1") {
    normalizedUrl.pathname = "/";
  }

  return normalizedUrl.toString().replace(/\/$/, "");
};

export const getLMStudioClient = () => {
  if (!globalThis.__comfyBridgeLmStudioClient) {
    globalThis.__comfyBridgeLmStudioClient = new LMStudioClient({
      baseUrl: getLMStudioSdkBaseUrl(),
      verboseErrorMessages: true,
    });
  }

  return globalThis.__comfyBridgeLmStudioClient;
};

export const getLMStudioModel = async () => {
  const client = getLMStudioClient();
  return client.llm.model(process.env.LM_STUDIO_MODEL!);
};
