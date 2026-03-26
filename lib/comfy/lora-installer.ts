import fs from "node:fs/promises";
import path from "node:path";

export type InstallBaseModel = "sdxl" | "illustrious" | "chroma" | "qwen";
export type LoraInstallProgress = {
  phase: "starting" | "downloading" | "saving" | "completed";
  downloadedBytes: number;
  totalBytes: number | null;
  percentage: number | null;
  message?: string;
};

const baseModelToSubfolder: Record<InstallBaseModel, string> = {
  sdxl: "illustration",
  illustrious: "illustration",
  chroma: "chroma",
  qwen: "qwen",
};

const sanitizeFileName = (value: string) => {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
};

const parseContentDispositionFilename = (value: string | null) => {
  if (!value) {
    return null;
  }

  const starMatch = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (starMatch?.[1]) {
    try {
      return decodeURIComponent(starMatch[1].trim());
    } catch {
      return starMatch[1].trim();
    }
  }

  const quotedMatch = value.match(/filename\s*=\s*"([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }

  const unquotedMatch = value.match(/filename\s*=\s*([^;]+)/i);
  return unquotedMatch?.[1]?.trim() ?? null;
};

const resolveFileName = ({
  requestedFileName,
  url,
  contentDisposition,
  contentType,
}: {
  requestedFileName?: string;
  url: string;
  contentDisposition: string | null;
  contentType: string | null;
}) => {
  const fromInput = requestedFileName?.trim() || null;
  const fromHeader = parseContentDispositionFilename(contentDisposition);
  const pathname = new URL(url).pathname;
  const fromUrlPath = path.basename(pathname || "");

  let selected = fromInput ?? fromHeader ?? fromUrlPath;
  if (!selected || selected === "/") {
    selected = `lora-${Date.now()}.safetensors`;
  }

  const safe = sanitizeFileName(selected) ?? `lora-${Date.now()}.safetensors`;
  const extension = path.extname(safe).toLowerCase();
  if (extension.length > 0) {
    return safe;
  }

  if (contentType?.toLowerCase().includes("safetensors")) {
    return `${safe}.safetensors`;
  }

  return `${safe}.safetensors`;
};

export const installLoraFromUrl = async (input: {
  url: string;
  baseModel: InstallBaseModel;
  fileName?: string;
  overwrite?: boolean;
  onProgress?: (progress: LoraInstallProgress) => void;
}) => {
  const emitProgress = (progress: LoraInstallProgress) => {
    try {
      input.onProgress?.(progress);
    } catch {
      // Ignore callback failures.
    }
  };

  emitProgress({
    phase: "starting",
    downloadedBytes: 0,
    totalBytes: null,
    percentage: null,
  });

  const loraRootDir = process.env.COMFY_LORA_DIR;
  if (!loraRootDir) {
    throw new Error("COMFY_LORA_DIR is not configured.");
  }

  const subfolder = baseModelToSubfolder[input.baseModel];
  const targetDir = path.join(loraRootDir, subfolder);
  await fs.mkdir(targetDir, { recursive: true });

  const requestHeaders: Record<string, string> = {};
  if (process.env.CIVITAI_API_KEY && input.url.includes("civitai.com")) {
    requestHeaders.Authorization = `Bearer ${process.env.CIVITAI_API_KEY}`;
  }

  let response: Response;
  try {
    response = await fetch(input.url, {
      method: "GET",
      headers: requestHeaders,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : String(error);
    throw new Error(`Download request failed: ${message}`);
  }

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Download failed (${response.status}). ${details.slice(0, 500)}`);
  }

  const totalBytesRaw = Number(response.headers.get("content-length") ?? "");
  const totalBytes =
    Number.isFinite(totalBytesRaw) && totalBytesRaw > 0 ? totalBytesRaw : null;

  const fileName = resolveFileName({
    requestedFileName: input.fileName,
    url: input.url,
    contentDisposition: response.headers.get("content-disposition"),
    contentType: response.headers.get("content-type"),
  });

  const targetPath = path.join(targetDir, fileName);
  const overwrite = input.overwrite === true;
  const relativePath = `${subfolder}/${fileName}`.replace(/[\\/]+/g, "/");

  if (!overwrite) {
    try {
      await fs.access(targetPath);
      throw new Error(
        `File already exists at ${relativePath}. Set overwrite=true to replace it.`,
      );
    } catch (error) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : null;
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }

  let bytes = Buffer.alloc(0);
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let downloadedBytes = 0;
    let lastEmittedBytes = -1;
    emitProgress({
      phase: "downloading",
      downloadedBytes,
      totalBytes,
      percentage: totalBytes ? Math.round((downloadedBytes / totalBytes) * 100) : null,
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      downloadedBytes += chunk.byteLength;

      const shouldEmit =
        totalBytes !== null
          ? downloadedBytes === totalBytes ||
            downloadedBytes - lastEmittedBytes >= Math.max(1, Math.floor(totalBytes / 40))
          : downloadedBytes - lastEmittedBytes >= 512 * 1024;

      if (shouldEmit) {
        lastEmittedBytes = downloadedBytes;
        emitProgress({
          phase: "downloading",
          downloadedBytes,
          totalBytes,
          percentage: totalBytes
            ? Math.max(0, Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)))
            : null,
        });
      }
    }

    bytes = Buffer.concat(chunks);
  } else {
    const arrayBuffer = await response.arrayBuffer();
    bytes = Buffer.from(arrayBuffer);
    emitProgress({
      phase: "downloading",
      downloadedBytes: bytes.byteLength,
      totalBytes,
      percentage:
        totalBytes && totalBytes > 0
          ? Math.max(0, Math.min(100, Math.round((bytes.byteLength / totalBytes) * 100)))
          : 100,
    });
  }

  if (bytes.byteLength <= 0) {
    throw new Error("Downloaded file is empty.");
  }

  emitProgress({
    phase: "saving",
    downloadedBytes: bytes.byteLength,
    totalBytes,
    percentage: 100,
  });

  try {
    await fs.writeFile(targetPath, bytes);
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : String(error);
    throw new Error(`Failed to save file to ${relativePath}: ${message}`);
  }

  emitProgress({
    phase: "completed",
    downloadedBytes: bytes.byteLength,
    totalBytes,
    percentage: 100,
  });

  return {
    baseModel: input.baseModel,
    installedPath: relativePath,
    bytes: bytes.byteLength,
  };
};
