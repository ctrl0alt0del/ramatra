import fs from "node:fs/promises";

import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const db = getDb();

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const jobId = (url.searchParams.get("jobId") ?? "").trim();
    const indexRaw = Number(url.searchParams.get("index") ?? "");
    const index = Number.isFinite(indexRaw) ? Math.floor(indexRaw) : -1;

    if (!jobId || index < 0) {
      return new Response("Invalid image request.", { status: 400 });
    }

    const row = db
      .prepare(
        `
          SELECT mime_type, file_path
          FROM comfy_generation_images
          WHERE job_id = ? AND position = ?
          LIMIT 1
        `,
      )
      .get(jobId, index) as
      | {
          mime_type: string;
          file_path: string;
        }
      | undefined;

    if (!row) {
      return new Response("Image not found.", { status: 404 });
    }

    const file = await fs.readFile(row.file_path);

    return new Response(file, {
      status: 200,
      headers: {
        "Content-Type": row.mime_type || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Failed to load image.", { status: 500 });
  }
}
