import { z } from "zod";

import { installLoraFromUrl } from "@/lib/comfy/lora-installer";
import { toHttpError } from "@/lib/errors/server-error";

export const runtime = "nodejs";

const requestSchema = z.object({
  url: z.string().url(),
  baseModel: z.enum(["sdxl", "illustrious", "chroma", "qwen"]),
  fileName: z.string().min(1).optional(),
  overwrite: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const parsed = requestSchema.safeParse(json);

    if (!parsed.success) {
      return Response.json(
        { error: "Invalid request", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const installed = await installLoraFromUrl(parsed.data);
    return Response.json({ ok: true, ...installed });
  } catch (error) {
    const httpErrorData = toHttpError(error);
    return new Response(httpErrorData.body, {
      status: httpErrorData.status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
