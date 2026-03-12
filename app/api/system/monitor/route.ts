import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { NextResponse } from "next/server";

import { getSchedulerSystemState } from "@/lib/tasks/gpu-manager";

const execFileAsync = promisify(execFile);

type ServiceMonitor = {
  ok: boolean;
  detail: string;
  activeModel: {
    key: string;
    instanceId: string;
    contextLength: number;
  } | null;
};

type GpuMonitor = {
  name: string;
  utilization: number | null;
  memoryUsedMb: number | null;
  memoryTotalMb: number | null;
  temperatureC: number | null;
} | null;

const withHttpProtocol = (url: string) => {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  return `http://${url}`;
};

const getComfyBaseUrl = () => {
  const baseUrl = process.env.COMFY_BASE_URL;
  if (!baseUrl) {
    throw new Error("COMFY_BASE_URL is not configured.");
  }

  return withHttpProtocol(baseUrl).replace(/\/$/, "");
};

const getLmStudioHttpBaseUrl = () => {
  const baseUrl = process.env.LM_STUDIO_BASE_URL;
  if (!baseUrl) {
    throw new Error("LM_STUDIO_BASE_URL is not configured.");
  }

  return baseUrl.replace(/\/$/, "");
};

const getLmStudioApiUrl = (pathname: string) => {
  const url = new URL(getLmStudioHttpBaseUrl());
  url.pathname = pathname;
  return url.toString();
};

const getLmStudioHeaders = () => ({
  "Content-Type": "application/json",
  ...(process.env.LM_STUDIO_TOKEN
    ? { Authorization: `Bearer ${process.env.LM_STUDIO_TOKEN}` }
    : {}),
});

const checkLmStudio = async (): Promise<ServiceMonitor> => {
  try {
    const response = await fetch(getLmStudioApiUrl("/api/v1/models"), {
      method: "GET",
      headers: getLmStudioHeaders(),
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        ok: false,
        detail: `HTTP ${response.status}`,
      };
    }

    const data = (await response.json()) as {
      models?: Array<{
        key: string;
        loaded_instances?: Array<{
          id?: string;
          config?: {
            context_length?: number;
          };
        }>;
      }>;
    };
    const loadedCount =
      data.models?.reduce(
        (total, model) => total + (model.loaded_instances?.length ?? 0),
        0,
      ) ?? 0;
    const activeModel =
      data.models
        ?.flatMap((model) =>
          (model.loaded_instances ?? []).map((instance) => ({
            key: model.key,
            instanceId: instance.id ?? model.key,
            contextLength: instance.config?.context_length ?? 0,
          })),
        )
        .sort((left, right) => right.contextLength - left.contextLength)[0] ?? null;

    return {
      ok: true,
      detail: loadedCount > 0 ? `${loadedCount} model(s) loaded` : "Reachable",
      activeModel,
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Unknown error",
      activeModel: null,
    };
  }
};

const checkComfy = async (): Promise<{
  service: ServiceMonitor;
  systemStats: unknown | null;
}> => {
  try {
    const response = await fetch(`${getComfyBaseUrl()}/system_stats`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        service: {
          ok: false,
          detail: `HTTP ${response.status}`,
        },
        systemStats: null,
      };
    }

    const systemStats = (await response.json()) as unknown;
    const devices = extractComfyDevices(systemStats);
    const deviceLabel =
      devices.length > 0 ? `${devices.length} device(s)` : "Reachable";

    return {
      service: {
        ok: true,
        detail: deviceLabel,
      },
      systemStats,
    };
  } catch (error) {
    return {
      service: {
        ok: false,
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      systemStats: null,
    };
  }
};

const extractComfyDevices = (systemStats: unknown) => {
  if (
    !systemStats ||
    typeof systemStats !== "object" ||
    !("devices" in systemStats) ||
    !Array.isArray(systemStats.devices)
  ) {
    return [];
  }

  return systemStats.devices.filter(
    (device): device is Record<string, unknown> =>
      !!device && typeof device === "object",
  );
};

const queryGpu = async (): Promise<GpuMonitor> => {
  try {
    const { stdout } = await execFileAsync("nvidia-smi", [
      "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
      "--format=csv,noheader,nounits",
    ]);

    const firstLine = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    if (!firstLine) {
      return null;
    }

    const [name, utilization, memoryUsedMb, memoryTotalMb, temperatureC] =
      firstLine.split(",").map((part) => part.trim());

    return {
      name,
      utilization: Number.isFinite(Number(utilization))
        ? Number(utilization)
        : null,
      memoryUsedMb: Number.isFinite(Number(memoryUsedMb))
        ? Number(memoryUsedMb)
        : null,
      memoryTotalMb: Number.isFinite(Number(memoryTotalMb))
        ? Number(memoryTotalMb)
        : null,
      temperatureC: Number.isFinite(Number(temperatureC))
        ? Number(temperatureC)
        : null,
    };
  } catch {
    return null;
  }
};

export async function GET() {
  const [lmStudio, comfy, gpu] = await Promise.all([
    checkLmStudio(),
    checkComfy(),
    queryGpu(),
  ]);

  const queue = getSchedulerSystemState();

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    services: {
      lmStudio,
      comfy: comfy.service,
    },
    gpu,
    comfySystem: comfy.systemStats,
    queue,
  });
}
