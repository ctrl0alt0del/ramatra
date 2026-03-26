import { listDirectComfyHistory } from "@/lib/comfy/direct-studio-history";
import { toHttpError } from "@/lib/errors/server-error";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rawLimit = Number(url.searchParams.get("limit") ?? "");
    const limit = Number.isFinite(rawLimit) ? rawLimit : 60;
    const items = listDirectComfyHistory(limit);
    return Response.json({ items });
  } catch (error) {
    const httpErrorData = toHttpError(error);
    return new Response(httpErrorData.body, {
      status: httpErrorData.status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
