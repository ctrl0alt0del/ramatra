import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const searchCivitaiLorasToolName = "search_civitai_loras";

const searchCivitaiLorasInputSchema = z.object({
  query: z.string().min(1),
  baseModel: z.enum(["sdxl", "illustrious", "qwen", "chroma"]).optional(),
  limit: z.number().int().min(1).max(12).optional(),
});

type CivitaiFile = {
  name?: unknown;
  downloadUrl?: unknown;
  type?: unknown;
  primary?: unknown;
};

type CivitaiImage = {
  url?: unknown;
};

type CivitaiModelVersion = {
  id?: unknown;
  name?: unknown;
  baseModel?: unknown;
  files?: unknown;
  images?: unknown;
};

type CivitaiModel = {
  id?: unknown;
  name?: unknown;
  stats?: unknown;
  modelVersions?: unknown;
};

type SearchResponse = {
  items?: unknown;
};

const toNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const toStringValue = (value: unknown) =>
  typeof value === "string" ? value : "";

const toArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const getCivitaiBaseUrl = () => {
  const url = process.env.CIVITAI_API_BASE_URL?.trim();
  return url && /^https?:\/\//i.test(url) ? url.replace(/\/$/, "") : "https://civitai.com";
};

const fetchJson = async (url: string) => {
  const headers: Record<string, string> = {};
  if (process.env.CIVITAI_API_KEY) {
    headers.Authorization = `Bearer ${process.env.CIVITAI_API_KEY}`;
  }

  const response = await fetch(url, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Civitai request failed (${response.status}): ${details.slice(0, 400)}`);
  }

  return (await response.json()) as unknown;
};

const baseModelFilter = (
  baseModel: "sdxl" | "illustrious" | "qwen" | "chroma" | undefined,
) => {
  if (baseModel === "illustrious") {
    return ["Illustrious"];
  }
  if (baseModel === "sdxl") {
    return ["SDXL 1.0", "Illustrious"];
  }
  return [];
};

const resolveDownloadFromVersion = async ({
  apiBase,
  version,
}: {
  apiBase: string;
  version: CivitaiModelVersion;
}) => {
  const files = toArray<CivitaiFile>(version.files);
  const preferred =
    files.find((file) => file.primary === true && typeof file.downloadUrl === "string") ??
    files.find((file) => toStringValue(file.type).toLowerCase().includes("model") && typeof file.downloadUrl === "string") ??
    files.find((file) => typeof file.downloadUrl === "string") ??
    null;

  if (preferred) {
    return {
      downloadUrl: toStringValue(preferred.downloadUrl),
      fileName: toStringValue(preferred.name) || null,
    };
  }

  const modelVersionId = toNumber(version.id);
  if (!modelVersionId) {
    return {
      downloadUrl: "",
      fileName: null,
    };
  }

  const detailsRaw = await fetchJson(`${apiBase}/api/v1/model-versions/${modelVersionId}`);
  const details = detailsRaw as { files?: unknown };
  const detailedFiles = toArray<CivitaiFile>(details.files);
  const fallback =
    detailedFiles.find((file) => file.primary === true && typeof file.downloadUrl === "string") ??
    detailedFiles.find((file) => typeof file.downloadUrl === "string") ??
    null;

  return {
    downloadUrl: fallback ? toStringValue(fallback.downloadUrl) : "",
    fileName: fallback ? toStringValue(fallback.name) || null : null,
  };
};

export const registerSearchCivitaiLorasMcpTool = (server: McpServer) => {
  server.registerTool(
    searchCivitaiLorasToolName,
    {
      title: "Search Civitai LoRAs",
      description:
        "Searches Civitai LoRA models and returns ready-to-render structured options (name, model, likes, downloads, image, download URL).",
      inputSchema: searchCivitaiLorasInputSchema,
    },
    async (input) => {
      try {
        const apiBase = getCivitaiBaseUrl();
        const limit = Math.max(1, Math.min(12, input.limit ?? 8));

        const params = new URLSearchParams();
        params.set("query", input.query.trim());
        params.set("limit", String(Math.max(20, limit * 3)));
        params.set("sort", "Most Downloaded");
        params.set("period", "AllTime");
        params.append("types", "LORA");

        for (const model of baseModelFilter(input.baseModel)) {
          params.append("baseModels", model);
        }

        const searchRaw = await fetchJson(`${apiBase}/api/v1/models?${params.toString()}`);
        const search = searchRaw as SearchResponse;
        const items = toArray<CivitaiModel>(search.items);

        const normalized = [] as Array<{
          name: string;
          model: string;
          likes: number;
          downloads: number;
          imageUrl: string | null;
          downloadUrl: string;
          fileName: string | null;
          baseModel: "sdxl" | "illustrious" | "qwen" | "chroma";
        }>;

        for (const model of items) {
          if (normalized.length >= limit) {
            break;
          }

          const name = toStringValue(model.name);
          const versions = toArray<CivitaiModelVersion>(model.modelVersions);
          const version = versions[0];
          if (!name || !version) {
            continue;
          }

          const versionBaseModel = toStringValue(version.baseModel).toLowerCase();
          const inferredBaseModel: "sdxl" | "illustrious" | "qwen" | "chroma" =
            input.baseModel ??
            (versionBaseModel.includes("illustrious")
              ? "illustrious"
              : versionBaseModel.includes("qwen")
                ? "qwen"
                : versionBaseModel.includes("chroma")
                  ? "chroma"
                  : "sdxl");

          if (input.baseModel && inferredBaseModel !== input.baseModel) {
            continue;
          }

          const stats = (model.stats ?? {}) as { downloadCount?: unknown; thumbsUpCount?: unknown };
          const likes = toNumber(stats.thumbsUpCount);
          const downloads = toNumber(stats.downloadCount);

          const images = toArray<CivitaiImage>(version.images);
          const imageUrl = toStringValue(images[0]?.url) || null;

          const download = await resolveDownloadFromVersion({ apiBase, version });
          if (!download.downloadUrl) {
            continue;
          }

          normalized.push({
            name,
            model: toStringValue(version.name) || toStringValue(version.baseModel) || "Unknown",
            likes,
            downloads,
            imageUrl,
            downloadUrl: download.downloadUrl,
            fileName: download.fileName,
            baseModel: inferredBaseModel,
          });
        }

        normalized.sort((a, b) => b.downloads - a.downloads || b.likes - a.likes);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ items: normalized.slice(0, limit) }),
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
                  : "Failed to search Civitai LoRAs.",
            },
          ],
          isError: true,
        };
      }
    },
  );
};
