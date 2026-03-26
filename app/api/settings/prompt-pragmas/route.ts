import { NextResponse } from "next/server";
import { z } from "zod";

import {
  listDefaultPromptPragmas,
  listPromptPragmaSettings,
  replacePromptPragmaSettings,
} from "@/lib/lmstudio/prompt-pragmas";

const promptPragmaSchema = z.object({
  name: z.string().min(1),
  template: z.string(),
});

const replacePromptPragmasSchema = z.object({
  pragmas: z.array(promptPragmaSchema),
});

export async function GET() {
  return NextResponse.json({
    pragmas: listPromptPragmaSettings(),
    defaults: listDefaultPromptPragmas(),
  });
}

export async function PUT(req: Request) {
  const json = await req.json();
  const parsed = replacePromptPragmasSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  return NextResponse.json({
    pragmas: replacePromptPragmaSettings(parsed.data.pragmas),
  });
}
