import fs from "node:fs/promises";
import path from "node:path";

export type InstallBaseModel = "sdxl" | "illustrious" | "chroma" | "qwen";

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
}) => {
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

  const response = await fetch(input.url, {
    method: "GET",
    headers: requestHeaders,
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Download failed (${response.status}). ${details.slice(0, 500)}`);
  }

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

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength <= 0) {
    throw new Error("Downloaded file is empty.");
  }

  await fs.writeFile(targetPath, Buffer.from(arrayBuffer));

  return {
    baseModel: input.baseModel,
    installedPath: relativePath,
    bytes: arrayBuffer.byteLength,
  };
};
