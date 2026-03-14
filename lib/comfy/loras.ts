import fs from "node:fs/promises";
import path from "node:path";

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

const normalizeLoraName = (value: string) =>
  value
    .trim()
    .replace(/[\\/]+/g, path.sep)
    .toLowerCase();

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
    const sizeBuffer = Buffer.alloc(8);
    await handle.read(sizeBuffer, 0, 8, 0);

    const headerLength = Number(sizeBuffer.readBigUInt64LE(0));
    if (!Number.isFinite(headerLength) || headerLength <= 0) {
      return null;
    }

    const headerBuffer = Buffer.alloc(headerLength);
    await handle.read(headerBuffer, 0, headerLength, 8);

    const header = JSON.parse(
      headerBuffer.toString("utf8"),
    ) as RawSafetensorsHeader;
    const metadata = header.__metadata__;
    if (!metadata) {
      return null;
    }

    const tagFrequencyValue =
      parseJsonMetadataField(metadata.ss_tag_frequency) ??
      metadata.ss_tag_frequency;

    return {
      name: metadata.name ?? null,
      outputName: metadata.ss_output_name ?? null,
      baseModelVersion: metadata.ss_base_model_version ?? null,
      topTag: getTopTag(flattenTagFrequency(tagFrequencyValue)),
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

      const metadata = await readSafetensorsMetadata(absolutePath);

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
  query,
  limit = 50,
}: {
  query?: string;
  limit?: number;
}) => {
  const normalizedQuery = query?.trim().toLowerCase() ?? "";
  const { loraDirectory, items } = await scanAvailableLoras();

  const filtered = items.filter((lora) => {
    if (!normalizedQuery) {
      return true;
    }

    const haystack = [
      lora.name,
      lora.metadata?.name ?? "",
      lora.metadata?.outputName ?? "",
      lora.metadata?.topTag?.name ?? "",
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });

  return {
    loraDirectory,
    total: filtered.length,
    items: filtered.slice(0, limit).map((lora) => ({
      name: lora.name,
    })),
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
