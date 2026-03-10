import { NextResponse } from "next/server";

export async function GET() {
  const ollamaBase = process.env.OLLAMA_BASE_URL!;
  const comfyBase = process.env.COMFY_BASE_URL!;

  const result = {
    ok: true,
    ollama: { ok: false as boolean, error: null as string | null },
    comfy: { ok: false as boolean, error: null as string | null },
  };

  try {
    const r = await fetch(`${ollamaBase}/api/tags`, { cache: "no-store" });
    result.ollama.ok = r.ok;
    if (!r.ok) result.ollama.error = `HTTP ${r.status}`;
  } catch (e) {
    result.ollama.error = e instanceof Error ? e.message : "Unknown error";
  }

  try {
    const r = await fetch(`${comfyBase}/system_stats`, { cache: "no-store" });
    result.comfy.ok = r.ok;
    if (!r.ok) result.comfy.error = `HTTP ${r.status}`;
  } catch (e) {
    result.comfy.error = e instanceof Error ? e.message : "Unknown error";
  }

  result.ok = result.ollama.ok && result.comfy.ok;

  return NextResponse.json(result, {
    status: result.ok ? 200 : 503,
  });
}
