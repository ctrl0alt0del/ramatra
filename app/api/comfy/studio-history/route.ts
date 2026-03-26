import {
  countDirectComfyHistory,
  deleteDirectComfyHistoryItem,
  listDirectComfyHistory,
} from "@/lib/comfy/direct-studio-history";
import { toHttpError } from "@/lib/errors/server-error";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rawLimit = Number(url.searchParams.get("limit") ?? "");
    const rawOffset = Number(url.searchParams.get("offset") ?? "");
    const limit = Number.isFinite(rawLimit) ? rawLimit : 60;
    const offset = Number.isFinite(rawOffset) ? rawOffset : 0;
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const safeOffset = Math.max(0, Math.floor(offset));

    const total = countDirectComfyHistory();
    const items = listDirectComfyHistory({
      limit: safeLimit,
      offset: safeOffset,
    });
    const nextOffset = safeOffset + items.length;
    const hasMore = nextOffset < total;

    return Response.json({
      items,
      total,
      limit: safeLimit,
      offset: safeOffset,
      nextOffset,
      hasMore,
    });
  } catch (error) {
    const httpErrorData = toHttpError(error);
    return new Response(httpErrorData.body, {
      status: httpErrorData.status,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const id = (url.searchParams.get("id") ?? "").trim();
    if (!id) {
      return Response.json({ error: "Missing id" }, { status: 400 });
    }

    const deleted = deleteDirectComfyHistoryItem(id);
    return Response.json({ deleted });
  } catch (error) {
    const httpErrorData = toHttpError(error);
    return new Response(httpErrorData.body, {
      status: httpErrorData.status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
