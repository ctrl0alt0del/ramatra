import { z } from "zod";

import { upsertDownloadedLoraMetadata } from "@/lib/comfy/downloaded-loras";
import { installLoraFromUrl } from "@/lib/comfy/lora-installer";
import { toHttpError } from "@/lib/errors/server-error";

export const runtime = "nodejs";

const requestSchema = z.object({
  url: z.string().url(),
  baseModel: z.enum(["sdxl", "illustrious", "chroma", "qwen"]),
  fileName: z.string().min(1).optional(),
  overwrite: z.boolean().optional(),
  modelId: z.number().int().positive().optional(),
  modelUrl: z.string().url().optional(),
  civitaiBaseModel: z.string().min(1).optional(),
  imageUrl: z.string().url().optional(),
  trainedWords: z.array(z.string().min(1)).optional(),
});

export async function POST(req: Request) {
  let requestSummary: {
    host: string | null;
    baseModel?: "sdxl" | "illustrious" | "chroma" | "qwen";
    fileName?: string;
    overwrite?: boolean;
  } | null = null;
  try {
    const json = await req.json();
    const parsed = requestSchema.safeParse(json);

    if (!parsed.success) {
      return Response.json(
        { error: "Invalid request", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    requestSummary = (() => {
      try {
        return {
          host: new URL(parsed.data.url).host,
          baseModel: parsed.data.baseModel,
          fileName: parsed.data.fileName,
          overwrite: parsed.data.overwrite === true,
        };
      } catch {
        return {
          host: null,
          baseModel: parsed.data.baseModel,
          fileName: parsed.data.fileName,
          overwrite: parsed.data.overwrite === true,
        };
      }
    })();

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const emit = (payload: unknown) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        };

        void (async () => {
          try {
            const installed = await installLoraFromUrl({
              ...parsed.data,
              onProgress: (progress) => {
                emit({
                  type: "progress",
                  ...progress,
                });
              },
            });
            upsertDownloadedLoraMetadata({
              installedPath: installed.installedPath,
              baseModel: parsed.data.baseModel,
              sourceUrl: parsed.data.url,
              modelId: parsed.data.modelId ?? null,
              modelUrl: parsed.data.modelUrl ?? null,
              civitaiBaseModel: parsed.data.civitaiBaseModel ?? null,
              imageUrl: parsed.data.imageUrl ?? null,
              trainedWords: parsed.data.trainedWords ?? [],
            });
            emit({
              type: "completed",
              ok: true,
              ...installed,
            });
          } catch (error) {
            const message =
              error instanceof Error && error.message.trim().length > 0
                ? error.message
                : String(error);
            emit({
              type: "error",
              error: message,
            });
          } finally {
            controller.close();
          }
        })();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : String(error);
    console.error("[studio-assistant] lora-download:failed", {
      request: requestSummary,
      message,
      stack: error instanceof Error ? error.stack ?? null : null,
      cause:
        error instanceof Error &&
        "cause" in error &&
        (error as { cause?: unknown }).cause
          ? String((error as { cause?: unknown }).cause)
          : null,
    });

    const httpErrorData = toHttpError(error);
    if (httpErrorData.status === 500) {
      return Response.json(
        {
          error: message,
        },
        { status: 500 },
      );
    }

    return new Response(httpErrorData.body, {
      status: httpErrorData.status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
