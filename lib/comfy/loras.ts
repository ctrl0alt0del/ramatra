import fs from "node:fs/promises";
import path from "node:path";

const supportedLoraExtensions = new Set([".safetensors", ".pt", ".ckpt"]);

type RawSafetensorsHeader = {
  __metadata__?: Record<string, string>;
};

type LoraMetadata = {
  name: string | null;
  outputName: string | null;
  baseModelVersion: string | null;
  tagFrequency: Record<string, number>;
};

export type LoraDescriptor = {
  relativePath: string;
  fileName: string;
  absolutePath: string;
  format: string;
  metadata: LoraMetadata | null;
};

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

const parseJsonMetadataField = (value: string | undefined) => {
  if (!value) return null;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const readSafetensorsMetadata = async (filePath: string): Promise<LoraMetadata | null> => {
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

    const header = JSON.parse(headerBuffer.toString("utf8")) as RawSafetensorsHeader;
    const metadata = header.__metadata__;
    if (!metadata) {
      return null;
    }

    const tagFrequencyValue =
      parseJsonMetadataField(metadata.ss_tag_frequency) ?? metadata.ss_tag_frequency;

    return {
      name: metadata.name ?? null,
      outputName: metadata.ss_output_name ?? null,
      baseModelVersion: metadata.ss_base_model_version ?? null,
      tagFrequency: flattenTagFrequency(tagFrequencyValue),
    };
  } finally {
    await handle.close();
  }
};

const readLoraMetadata = async (filePath: string): Promise<LoraMetadata | null> => {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".safetensors") {
    return readSafetensorsMetadata(filePath);
  }

  return null;
};

const walkLoraDirectory = async (directoryPath: string): Promise<string[]> => {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        return walkLoraDirectory(absolutePath);
      }

      if (!entry.isFile()) {
        return [];
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!supportedLoraExtensions.has(extension)) {
        return [];
      }

      return [absolutePath];
    }),
  );

  return files.flat();
};

export const listAvailableLoras = async ({
  query,
  limit = 50,
}: {
  query?: string;
  limit?: number;
}) => {
  const loraDirectory = process.env.COMFY_LORA_DIR;
  if (!loraDirectory) {
    throw new Error("COMFY_LORA_DIR is not configured.");
  }

  const normalizedQuery = query?.trim().toLowerCase() ?? "";

  const files = await walkLoraDirectory(loraDirectory);
  const loras = await Promise.all(
    files.map(async (absolutePath) => {
      const relativePath = path
        .relative(loraDirectory, absolutePath)
        .split(path.sep)
        .join("/");

      const metadata = await readLoraMetadata(absolutePath);

      return {
        relativePath,
        fileName: path.basename(absolutePath),
        absolutePath,
        format: path.extname(absolutePath).slice(1).toLowerCase(),
        metadata,
      } satisfies LoraDescriptor;
    }),
  );

  const filtered = loras.filter((lora) => {
    if (!normalizedQuery) {
      return true;
    }

    const haystack = [
      lora.relativePath,
      lora.fileName,
      lora.metadata?.name ?? "",
      lora.metadata?.outputName ?? "",
      ...Object.keys(lora.metadata?.tagFrequency ?? {}),
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });

  return {
    loraDirectory,
    total: filtered.length,
    items: filtered.slice(0, limit),
  };
};
