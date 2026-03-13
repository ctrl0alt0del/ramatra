import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getDefaultSystemPromptForMode,
  listSystemPromptsByMode,
  updateSystemPromptForMode,
} from "@/lib/lmstudio/prompts";
import { isPromptMode, promptModes } from "@/lib/lmstudio/prompt-modes";

const updatePromptsSchema = z.object({
  prompts: z.record(z.string(), z.string()),
});

export async function GET() {
  const prompts = listSystemPromptsByMode();

  return NextResponse.json({
    prompts,
    defaults: {
      fast: getDefaultSystemPromptForMode("fast"),
      regular: getDefaultSystemPromptForMode("regular"),
      writer: getDefaultSystemPromptForMode("writer"),
      artist: getDefaultSystemPromptForMode("artist"),
    },
    modes: promptModes,
  });
}

export async function PATCH(req: Request) {
  const json = await req.json();
  const parsed = updatePromptsSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  for (const [mode, prompt] of Object.entries(parsed.data.prompts)) {
    if (!isPromptMode(mode)) {
      return NextResponse.json(
        { error: `Unsupported mode: ${mode}` },
        { status: 400 },
      );
    }

    updateSystemPromptForMode(mode, prompt);
  }

  return NextResponse.json({
    prompts: listSystemPromptsByMode(),
  });
}
