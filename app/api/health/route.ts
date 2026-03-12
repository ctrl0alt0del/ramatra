import { NextResponse } from "next/server";

export async function GET() {
  const lmStudioBase = process.env.LM_STUDIO_BASE_URL!;
  const comfyBase = process.env.COMFY_BASE_URL!;
  const lmStudioUrl = new URL(lmStudioBase);
  lmStudioUrl.pathname = "/api/v1/models";

  const result = {
    ok: true,
    lmStudio: { ok: false as boolean, error: null as string | null },
    comfy: { ok: false as boolean, error: null as string | null },
  };

  try {
    const r = await fetch(lmStudioUrl.toString(), {
      cache: "no-store",
      headers: process.env.LM_STUDIO_TOKEN
        ? { Authorization: `Bearer ${process.env.LM_STUDIO_TOKEN}` }
        : undefined,
    });
    result.lmStudio.ok = r.ok;
    if (!r.ok) result.lmStudio.error = `HTTP ${r.status}`;
  } catch (e) {
    result.lmStudio.error = e instanceof Error ? e.message : "Unknown error";
  }

  try {
    const comfyUrl = /^https?:\/\//i.test(comfyBase)
      ? comfyBase
      : `http://${comfyBase}`;
    const r = await fetch(`${comfyUrl}/system_stats`, { cache: "no-store" });
    result.comfy.ok = r.ok;
    if (!r.ok) result.comfy.error = `HTTP ${r.status}`;
  } catch (e) {
    result.comfy.error = e instanceof Error ? e.message : "Unknown error";
  }

  result.ok = result.lmStudio.ok && result.comfy.ok;

  return NextResponse.json(result, {
    status: result.ok ? 200 : 503,
  });
}
