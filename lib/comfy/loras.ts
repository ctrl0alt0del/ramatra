import fs from "node:fs/promises";
import path from "node:path";

import {
  deleteDownloadedLoraMetadataByInstalledPath,
  listDownloadedLoraMetadataByInstalledPaths,
} from "@/lib/comfy/downloaded-loras";
import type { WorkflowName } from "@/lib/comfy/workflows/types";

type RawSafetensorsHeader = {
  __metadata__?: Record<string, string>;
};

type LoraMetadata = {
  name: string | null;
  outputName: string | null;
  baseModelVersion: string | null;
  topTag: {
    name: string;
    count: number;
  } | null;
};

export type LoraDescriptor = {
  name: string;
  format: string;
  metadata: LoraMetadata | null;
};

export type RequestedLora = {
  name: string;
  strength_model: number;
  strength_clip: number;
};

const STATIC_LORA_SUBFOLDERS = [
  "illustr_style",
  "chroma",
  "illustration",
  "qwen",
] as const;
const WORKFLOW_LORA_SUBFOLDERS: Record<WorkflowName, string[]> = {
  base: ["chroma"],
  edit: ["qwen"],
  illustration: ["illustration", "illustr_style"],
  radiance: ["chroma"],
};

const normalizeLoraPath = (value: string) => {
  return value
    .trim()
    .replace(/[\\/]+/g, "/")
    .toLowerCase();
};

const isAllowedForWorkflow = (
  loraName: string,
  workflowName: WorkflowName | undefined,
) => {
  if (!workflowName) {
    return true;
  }

  const allowedSubfolders = WORKFLOW_LORA_SUBFOLDERS[workflowName];
  const normalizedName = normalizeLoraPath(loraName);
  return allowedSubfolders.some((subfolder) =>
    normalizedName.startsWith(`${normalizeLoraPath(subfolder)}/`),
  );
};

const normalizeLoraName = (value: string) =>
  value
    .trim()
    .replace(/[\\/]+/g, path.sep)
    .toLowerCase();

const normalizeLoraRelativePath = (value: string) =>
  value.trim().replace(/[\\/]+/g, "/").toLowerCase();

const flattenTagFrequency = (value: unknown) => {
  if (!value || typeof value !== "object") {
    return {} as Record<string, number>;
  }

  const flattened = new Map<string, number>();

  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") {
      return;
    }

    for (const [key, nestedValue] of Object.entries(
      node as Record<string, unknown>,
    )) {
      if (typeof nestedValue === "number") {
        flattened.set(key, (flattened.get(key) ?? 0) + nestedValue);
        continue;
      }

      visit(nestedValue);
    }
  };

  visit(value);
  return Object.fromEntries(
    [...flattened.entries()].sort((a, b) => b[1] - a[1]),
  );
};

const getTopTag = (tagFrequency: Record<string, number>) => {
  const [name, count] = Object.entries(tagFrequency)[0] ?? [];
  if (!name || typeof count !== "number") {
    return null;
  }

  return { name, count };
};

const normalizeConcept = (value: string) => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
};

const normalizeConceptHaystack = (value: string) => {
  return normalizeConcept(value).replace(/^_+|_+$/g, "");
};

const conceptMatchesLoraFileName = (loraName: string, concept: string) => {
  if (!concept) {
    return false;
  }

  const basename = path.basename(loraName, path.extname(loraName));
  if (!basename.startsWith("$")) {
    return false;
  }
  const normalizedBase = normalizeConceptHaystack(basename);
  if (!normalizedBase) {
    return false;
  }

  const wrappedBase = `_${normalizedBase}_`;
  const wrappedConcept = `_${concept}_`;
  return wrappedBase.includes(wrappedConcept);
};

const parseJsonMetadataField = (value: string | undefined) => {
  if (!value) return null;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const readSafetensorsMetadata = async (
  filePath: string,
): Promise<LoraMetadata | null> => {
  const handle = await fs.open(filePath, "r");

  try {
    const fileStat = await handle.stat();
    const fileSize = fileStat.size;
    if (!Number.isFinite(fileSize) || fileSize <= 8) {
      return null;
    }

    const sizeBuffer = Buffer.alloc(8);
    await handle.read(sizeBuffer, 0, 8, 0);

    const headerLengthBigInt = sizeBuffer.readBigUInt64LE(0);
    if (headerLengthBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }

    const headerLength = Number(headerLengthBigInt);
    if (!Number.isFinite(headerLength) || headerLength <= 0) {
      return null;
    }
    // Corrupted or non-safetensors files can report absurd header lengths.
    if (headerLength > fileSize - 8) {
      return null;
    }
    // Hard cap for metadata header sanity.
    if (headerLength > 16 * 1024 * 1024) {
      return null;
    }

    const headerBuffer = Buffer.alloc(headerLength);
    await handle.read(headerBuffer, 0, headerLength, 8);

    let header: RawSafetensorsHeader;
    try {
      header = JSON.parse(headerBuffer.toString("utf8")) as RawSafetensorsHeader;
    } catch {
      return null;
    }
    const metadata = header.__metadata__;
    if (!metadata) {
      return null;
    }

    const tagFrequencyValue =
      parseJsonMetadataField(metadata.ss_tag_frequency) ??
      metadata.ss_tag_frequency;
    const tagFrequency = flattenTagFrequency(tagFrequencyValue);

    return {
      name: metadata.name ?? null,
      outputName: metadata.ss_output_name ?? null,
      baseModelVersion: metadata.ss_base_model_version ?? null,
      topTag: getTopTag(tagFrequency),
    };
  } finally {
    await handle.close();
  }
};

const listSafetensorsInDirectory = async (
  directoryPath: string,
): Promise<string[]> => {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(directoryPath, entry.name))
    .filter(
      (absolutePath) =>
        path.extname(absolutePath).toLowerCase() === ".safetensors",
    );
};

const listStaticSubfolderSafetensors = async (rootDirectoryPath: string) => {
  const discovered: string[] = [];

  for (const subfolder of STATIC_LORA_SUBFOLDERS) {
    const subfolderPath = path.join(rootDirectoryPath, subfolder);
    try {
      const stat = await fs.stat(subfolderPath);
      if (!stat.isDirectory()) {
        continue;
      }

      const files = await listSafetensorsInDirectory(subfolderPath);
      discovered.push(...files);
    } catch (error) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : null;

      if (code === "ENOENT") {
        continue;
      }

      throw error;
    }
  }

  return discovered;
};

const scanAvailableLoras = async () => {
  const loraDirectory = process.env.COMFY_LORA_DIR;
  if (!loraDirectory) {
    throw new Error("COMFY_LORA_DIR is not configured.");
  }

  const subfolderFiles = await listStaticSubfolderSafetensors(loraDirectory);
  const files = subfolderFiles;
  const loras = await Promise.all(
    files.map(async (absolutePath) => {
      const name = path.relative(loraDirectory, absolutePath);

      let metadata: LoraMetadata | null = null;
      try {
        metadata = await readSafetensorsMetadata(absolutePath);
      } catch {
        metadata = null;
      }

      return {
        name,
        format: path.extname(absolutePath).slice(1).toLowerCase(),
        metadata,
      } satisfies LoraDescriptor;
    }),
  );

  return {
    loraDirectory,
    items: loras,
  };
};

export const listAvailableLoras = async ({
  workflowName,
  concepts,
}: {
  workflowName?: WorkflowName;
  concepts?: string[];
}) => {
  const { loraDirectory, items } = await scanAvailableLoras();
  const normalizedConcepts = new Set(
    (concepts ?? []).map(normalizeConcept).filter((concept) => concept.length > 0),
  );

  const filtered = items.filter((lora) => {
    if (!isAllowedForWorkflow(lora.name, workflowName)) {
      return false;
    }

    if (normalizedConcepts.size > 0) {
      const topTag = normalizeConcept(lora.metadata?.topTag?.name ?? "");
      const hasTopTagMatch = topTag.length > 0 && normalizedConcepts.has(topTag);
      const hasFileNameConceptMatch = [...normalizedConcepts].some((concept) =>
        conceptMatchesLoraFileName(lora.name, concept),
      );

      if (!hasTopTagMatch && !hasFileNameConceptMatch) {
        return false;
      }
    }

    return true;
  });
  const downloadedMetadataByPath = listDownloadedLoraMetadataByInstalledPaths(
    filtered.map((item) => item.name),
  );

  return {
    loraDirectory,
    workflowName: workflowName ?? null,
    concepts: concepts ?? [],
    allowedSubfolders: workflowName
      ? WORKFLOW_LORA_SUBFOLDERS[workflowName]
      : [...STATIC_LORA_SUBFOLDERS],
    total: filtered.length,
    items: filtered.map((lora) => {
      const downloadedMetadata = downloadedMetadataByPath.get(
        normalizeLoraPath(lora.name),
      );
      return {
        name: lora.name,
        top_tag: lora.metadata?.topTag?.name ?? null,
        trained_words: downloadedMetadata?.trainedWords ?? [],
        image_url: downloadedMetadata?.imageUrl ?? null,
        civitai_base_model: downloadedMetadata?.civitaiBaseModel ?? null,
        model_url: downloadedMetadata?.modelUrl ?? null,
      };
    }),
  };
};
const getClosestLoraMatches = (
  requestedName: string,
  available: LoraDescriptor[],
) => {
  const normalizedRequestedName = normalizeLoraName(requestedName);
  if (!normalizedRequestedName) return [];

  const scored = available
    .map((lora) => {
      const fileName = path.basename(lora.name);
      const candidates = [lora.name, fileName];
      const score = candidates.reduce((best, candidate) => {
        const normalizedCandidate = normalizeLoraName(candidate);
        if (normalizedCandidate === normalizedRequestedName) return 100;
        if (normalizedCandidate.includes(normalizedRequestedName))
          return Math.max(best, 60);
        if (normalizedRequestedName.includes(normalizedCandidate))
          return Math.max(best, 50);
        const requestedBase = normalizedRequestedName.replace(/\.[^.]+$/, "");
        const candidateBase = normalizedCandidate.replace(/\.[^.]+$/, "");
        if (
          candidateBase.includes(requestedBase) ||
          requestedBase.includes(candidateBase)
        ) {
          return Math.max(best, 40);
        }
        return best;
      }, 0);

      return {
        name: lora.name,
        score,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return scored.slice(0, 5);
};

export const validateRequestedLoras = async (
  requestedLoras: RequestedLora[],
) => {
  if (!requestedLoras.length) {
    return {
      ok: true as const,
      resolved: [] as RequestedLora[],
    };
  }

  const { items } = await scanAvailableLoras();
  const byName = new Map(
    items.map((lora) => [normalizeLoraName(lora.name), lora.name]),
  );
  const fileNameMatches = new Map<string, string[]>();

  for (const lora of items) {
    const key = path.basename(lora.name).toLowerCase();
    const existing = fileNameMatches.get(key) ?? [];
    existing.push(lora.name);
    fileNameMatches.set(key, existing);
  }

  const resolved: RequestedLora[] = [];

  for (const requested of requestedLoras) {
    const normalizedName = normalizeLoraName(requested.name);
    const exactName = byName.get(normalizedName);

    if (exactName) {
      resolved.push({
        ...requested,
        name: exactName,
      });
      continue;
    }

    const exactFileNameMatches = fileNameMatches.get(normalizedName) ?? [];
    if (exactFileNameMatches.length === 1) {
      resolved.push({
        ...requested,
        name: exactFileNameMatches[0],
      });
      continue;
    }

    const suggestions = getClosestLoraMatches(requested.name, items);
    const suggestionText =
      suggestions.length > 0
        ? ` Closest available LoRAs: ${suggestions
            .map((suggestion) => suggestion.name)
            .join(", ")}.`
        : "";

    if (exactFileNameMatches.length > 1) {
      return {
        ok: false as const,
        error:
          `LoRA "${requested.name}" is ambiguous. Use the exact relative path returned by list_available_loras.` +
          ` Matching LoRAs: ${exactFileNameMatches.join(", ")}.`,
      };
    }

    return {
      ok: false as const,
      error:
        `LoRA "${requested.name}" was not found. Use the exact file name or relative path returned by list_available_loras.` +
        suggestionText,
    };
  }

  return {
    ok: true as const,
    resolved,
  };
};

export const deleteAvailableLora = async (name: string) => {
  const loraDirectory = process.env.COMFY_LORA_DIR;
  if (!loraDirectory) {
    throw new Error("COMFY_LORA_DIR is not configured.");
  }

  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("LoRA name is required.");
  }

  if (path.isAbsolute(trimmedName)) {
    throw new Error("Absolute LoRA paths are not allowed.");
  }

  const requestedRelativePath = trimmedName.replace(/[\\/]+/g, path.sep);
  const absolutePath = path.resolve(loraDirectory, requestedRelativePath);
  const relativePath = path.relative(loraDirectory, absolutePath);

  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath) ||
    !relativePath
  ) {
    throw new Error("Invalid LoRA path.");
  }

  const normalizedRelativePath = normalizeLoraRelativePath(relativePath);
  const allowed = STATIC_LORA_SUBFOLDERS.some((subfolder) =>
    normalizedRelativePath.startsWith(`${subfolder}/`),
  );

  if (!allowed) {
    throw new Error("Deleting LoRAs is only allowed in static LoRA subfolders.");
  }

  if (path.extname(relativePath).toLowerCase() !== ".safetensors") {
    throw new Error("Only .safetensors LoRA files can be deleted.");
  }

  await fs.unlink(absolutePath);
  deleteDownloadedLoraMetadataByInstalledPath(relativePath);

  return {
    deleted: true as const,
    name: normalizedRelativePath,
  };
};

