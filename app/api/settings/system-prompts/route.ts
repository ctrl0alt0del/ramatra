import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getDefaultSystemPromptForMode,
  listSystemPromptsByMode,
  updateSystemPromptForMode,
} from "@/lib/lmstudio/prompts";
import { isPromptMode, promptModes } from "@/lib/lmstudio/prompt-modes";
import {
  getDefaultStudioAssistantSystemPrompt,
  getStudioAssistantModeKey,
  getStudioAssistantSystemPrompt,
  updateStudioAssistantSystemPrompt,
} from "@/lib/lmstudio/studio-assistant-prompts";

const updatePromptsSchema = z.object({
  prompts: z.record(z.string(), z.string()),
});

export async function GET() {
  const studioAssistantMode = getStudioAssistantModeKey();
  const prompts = {
    ...listSystemPromptsByMode(),
    [studioAssistantMode]: getStudioAssistantSystemPrompt(),
  };
  const modeKeys = [...promptModes, studioAssistantMode];
  const defaults = Object.fromEntries(
    modeKeys.map((mode) =>
      mode === studioAssistantMode
        ? [mode, getDefaultStudioAssistantSystemPrompt()]
        : [mode, getDefaultSystemPromptForMode(mode)],
    ),
  );

  return NextResponse.json({
    prompts,
    defaults,
    modes: modeKeys,
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
    if (mode === getStudioAssistantModeKey()) {
      updateStudioAssistantSystemPrompt(prompt);
      continue;
    }

    if (!isPromptMode(mode)) {
      return NextResponse.json(
        { error: `Unsupported mode: ${mode}` },
        { status: 400 },
      );
    }

    updateSystemPromptForMode(mode, prompt);
  }

  return NextResponse.json({
    prompts: {
      ...listSystemPromptsByMode(),
      [getStudioAssistantModeKey()]: getStudioAssistantSystemPrompt(),
    },
  });
}
