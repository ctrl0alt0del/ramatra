import { tool, type Tool } from "@lmstudio/sdk";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { encodeComfyJobMarker } from "@/components/chat/comfy-marker";
import { validateRequestedLoras } from "@/lib/comfy/loras";
import { getGeneratedImagesForThread } from "@/lib/comfy/thread-generated-images";
import { workflowNames } from "@/lib/comfy/workflows/types";
import { getThread } from "@/lib/lmstudio/threads";
import { ensureComfyQueueListeners } from "@/lib/tasks/comfy-runner";
import { enqueueComfyTask, getActiveTask } from "@/lib/tasks/scheduler";

export const generateImageToolName = "generate_image";
export const generateImageToolTitle = "Generate Image";
export const generateImageToolDescription =
  "Starts an image generation job in ComfyUI for the selected workflow and returns a queued job marker. Available workflows: base, illustration, edit. For edit workflow, prefer imageRefs like user:1 or generated:1 so the model can select images from the current conversation; direct inputImage filenames are still supported. Before the first image generation in a conversation, list_available_loras should normally be called so LoRAs can be preferred when they directly match the requested concept. Start with sampler euler, scheduler simple, and steps 25 by default. In loras[].name, use the exact name returned by list_available_loras. Do not automatically retry after a failed generate_image call.";

export const generateImageParameters = {
  workflowName: z.enum(workflowNames).default("base"),
  prompt: z.string().min(1, "Prompt cannot be empty"),
  negativePrompt: z.string().default(""),
  imageRefs: z.array(z.string().min(1)).max(3).default([]),
  inputImage: z.array(z.string().min(1)).max(3).default([]),
  steps: z.number().int().positive().max(1000).default(25),
  width: z.number().int().positive().max(2048).default(512),
  height: z.number().int().positive().max(2048).default(512),
  cfg: z.number().positive().max(3.5).default(1),
  seed: z
    .number()
    .int()
    .positive()
    .default(() => Math.floor(Math.random() * 1000000)),
  samplerName: z.string().default("euler"),
  scheduler: z.string().default("simple"),
  loras: z
    .array(
      z.object({
        name: z.string().min(1, "LoRA file name or relative path cannot be empty"),
        strength_model: z.number(),
        strength_clip: z.number(),
      }),
    )
    .default([]),
};

export const generateImageInputSchema = z.object(generateImageParameters);

export type GenerateImageInput = z.infer<typeof generateImageInputSchema>;

export type GenerateImageResult =
  | {
      ok: true;
      workflowName: string;
      taskId: string;
      jobId: string | null;
      status: "queued" | "running";
      marker: string;
    }
  | {
      ok: false;
      error: string;
    };

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

const toImageBufferFromDataUrl = (dataUrl: string) => {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid data URL image format.");
  }

  const mimeType = match[1];
  const base64Data = match[2];
  return {
    mimeType,
    data: Buffer.from(base64Data, "base64"),
  };
};

const extensionByMimeType: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
};

const uploadDataUrlToComfyInput = async (dataUrl: string, position: number) => {
  const { mimeType, data } = toImageBufferFromDataUrl(dataUrl);
  const extension = extensionByMimeType[mimeType.toLowerCase()] ?? "png";
  const fileName = `comfy-bridge-ref-${Date.now()}-${position}-${crypto.randomUUID()}.${extension}`;
  const form = new FormData();
  form.append("image", new Blob([data], { type: mimeType }), fileName);
  form.append("type", "input");
  form.append("overwrite", "false");

  const response = await fetch(`${getComfyBaseUrl()}/upload/image`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Comfy image upload failed (${response.status}): ${details}`);
  }

  const json = (await response.json()) as {
    name?: string;
    subfolder?: string;
  };

  if (!json.name) {
    throw new Error("Comfy image upload did not return a file name.");
  }

  return json.subfolder?.trim() ? `${json.subfolder}/${json.name}` : json.name;
};

const parseImageRef = (ref: string) => {
  const match = ref.trim().toLowerCase().match(/^(user|generated):(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    source: match[1] as "user" | "generated",
    index: Number.parseInt(match[2], 10),
  };
};

const getUserImagePoolFromThread = (threadId: string | null, currentUserImageDataUrls: string[]) => {
  const pool: string[] = [...currentUserImageDataUrls];
  const thread = threadId ? getThread(threadId) : null;

  if (!thread) {
    return pool;
  }

  for (let messageIndex = thread.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = thread.messages[messageIndex];
    if (message.role !== "user") {
      continue;
    }

    for (const part of message.content) {
      if (part.type !== "image") {
        continue;
      }
      pool.push(part.dataUrl);
    }
  }

  return pool.filter((dataUrl, index, arr) => arr.indexOf(dataUrl) === index);
};

const getReferenceableImages = () => {
  const activeTask = getActiveTask();
  if (
    !activeTask ||
    activeTask.type !== "chat" ||
    activeTask.payload.kind !== "conversation"
  ) {
    return {
      user: [] as string[],
      generated: [] as string[],
    };
  }

  const currentUserImages = activeTask.payload.userMessage
    .filter(
      (part): part is { type: "image"; dataUrl: string } => part.type === "image",
    )
    .map((part) => part.dataUrl);
  const user = getUserImagePoolFromThread(
    activeTask.payload.threadId,
    currentUserImages,
  );

  const thread = activeTask.payload.threadId ? getThread(activeTask.payload.threadId) : null;
  const generated = thread
    ? getGeneratedImagesForThread(thread.messages, 12)
        .filter(
          (part): part is { type: "image"; dataUrl: string } => part.type === "image",
        )
        .map((part) => part.dataUrl)
    : [];

  return {
    user,
    generated,
  };
};

const resolveImageRefsToDataUrls = (refs: string[]) => {
  const pools = getReferenceableImages();
  const resolved: string[] = [];

  for (const ref of refs) {
    const parsed = parseImageRef(ref);
    if (!parsed) {
      throw new Error(
        `Invalid imageRefs entry "${ref}". Use "user:N" or "generated:N", e.g. "user:1".`,
      );
    }

    const pool = parsed.source === "user" ? pools.user : pools.generated;
    const imageDataUrl = pool[parsed.index - 1];
    if (!imageDataUrl) {
      throw new Error(
        `imageRefs entry "${ref}" is out of range. Available counts: user=${pools.user.length}, generated=${pools.generated.length}.`,
      );
    }

    resolved.push(imageDataUrl);
  }

  return resolved;
};

export const executeGenerateImage = async (
  input: GenerateImageInput,
): Promise<GenerateImageResult> => {
  const {
    workflowName,
    prompt,
    negativePrompt,
    imageRefs,
    inputImage,
    steps,
    width,
    height,
    cfg,
    seed,
    samplerName,
    scheduler,
    loras,
  } = input;

  try {
    const validatedLoras = await validateRequestedLoras(loras);
    if (!validatedLoras.ok) {
      return {
        ok: false,
        error: validatedLoras.error,
      };
    }

    const refDataUrls = resolveImageRefsToDataUrls(imageRefs);
    const uploadedRefImages = await Promise.all(
      refDataUrls.map((dataUrl, index) => uploadDataUrlToComfyInput(dataUrl, index + 1)),
    );
    const resolvedInputImage = [...uploadedRefImages, ...inputImage]
      .filter((item, index, arr) => !!item && arr.indexOf(item) === index)
      .slice(0, 3);

    if (workflowName === "edit" && resolvedInputImage.length === 0) {
      return {
        ok: false,
        error:
          "The edit workflow requires at least one image. Pass imageRefs (e.g. user:1 or generated:1) or inputImage filenames.",
      };
    }

    const task = enqueueComfyTask({
      workflowName,
      prompt,
      negativePrompt,
      inputImage: resolvedInputImage,
      width,
      height,
      steps,
      cfg,
      seed,
      samplerName,
      scheduler,
      loras: validatedLoras.resolved,
    });
    ensureComfyQueueListeners();

    return {
      ok: true,
      workflowName,
      taskId: task.id,
      jobId: null,
      status: "queued",
      marker: encodeComfyJobMarker({
        taskId: task.id,
        jobId: null,
        status: "queued",
        workflowName,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error: `Image generation failed to start: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    };
  }
};

export const getGenerateImageOpenAIToolSpec = () => ({
  type: "function" as const,
  function: {
    name: generateImageToolName,
    description:
      "Use this whenever the user asks to create, generate, render, draw, or make an image. Choose the workflowName explicitly. Available workflows: 'base', 'illustration', and 'edit'. Default to workflowName 'base' for most requests and choose 'illustration' for stylized/anime/illustrative outputs. For 'edit', choose imageRefs explicitly so the model decides which source image to use: use 'user:N' for recent user-attached images in thread context and 'generated:N' for recent generated images (N starts at 1, with generated:1 being the most recent). inputImage (filenames) is also supported but imageRefs is preferred. Pass cfg 1 unless stronger prompt adherence is truly needed, and provide any LoRAs that should be applied. Before the first image generation in a conversation, call list_available_loras unless the LoRA inventory was already checked and is still relevant. Prefer LoRAs whenever they directly match the requested concept, subject, style, or tags. Start with samplerName 'euler', scheduler 'simple', and steps 25. If higher quality is requested, switch next to samplerName 'res_2s' and scheduler 'beta57'. Only then should you increase steps. In loras[].name, use the exact name returned by list_available_loras. If the tool call fails, do not automatically call generate_image again.",
    parameters: z.toJSONSchema(generateImageInputSchema),
  },
});

export const parseGenerateImageArguments = (rawArguments: string) => {
  const parsed = JSON.parse(rawArguments) as unknown;
  return generateImageInputSchema.parse(parsed);
};

export const createGenerateImageLmStudioTool = (
  onResult?: (result: GenerateImageResult) => void,
): Tool =>
  tool({
    name: generateImageToolName,
    description: generateImageToolDescription,
    parameters: generateImageParameters,
    implementation: async (input, ctx) => {
      console.log("Executing generate image tool with input:", input);
      const result = await executeGenerateImage(input);
      onResult?.(result);

      if (result.ok) {
        ctx.status(`Queued image task ${result.taskId}`);
      } else {
        ctx.status("Image generation failed");
      }

      return result;
    },
  });

export const registerGenerateImageMcpTool = (server: McpServer) => {
  server.registerTool(
    generateImageToolName,
    {
      title: generateImageToolTitle,
      description:
        "Starts an image generation job in ComfyUI for the selected workflow and returns a job marker that must be preserved verbatim in the assistant response. Available workflows: base, illustration, and edit. Default to workflowName 'base' for most requests; choose 'illustration' for stylized/anime/illustrative outputs. For 'edit', provide imageRefs to select source images from conversation context: 'user:N' for recent user-attached images in thread context and 'generated:N' for recent generated images (generated:1 is the most recent). inputImage (filenames) is also accepted. Keep cfg at 1 unless a small increase is clearly needed. Before the first image generation in a conversation, list_available_loras should normally be called first, and LoRAs should be preferred when they directly match the requested concept or tags. Start with sampler euler, scheduler simple, and steps 25. If more quality is needed, switch next to res_2s and beta57, then increase steps only if needed after that. In loras[].name, use the exact name returned by list_available_loras. If the tool call fails, do not automatically call generate_image again.",
      inputSchema: generateImageInputSchema,
    },
    async (input) => {
      const result = await executeGenerateImage(input);

      return {
        content: [
          {
            type: "text",
            text: result.ok
              ? "Generation started. Include the marker below exactly once and verbatim in your final response.\n\n" +
                result.marker
              : result.error,
          },
        ],
      };
    },
  );
};


