import { NextResponse } from "next/server";
import { z } from "zod";

import { listMoodSettings, replaceMoodSettings } from "@/lib/lmstudio/moods";

const moodSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  prompt: z.string(),
});

const replaceMoodsSchema = z.object({
  moods: z.array(moodSchema),
});

export async function GET() {
  return NextResponse.json({
    moods: listMoodSettings(),
  });
}

export async function PUT(req: Request) {
  const json = await req.json();
  const parsed = replaceMoodsSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const moods = replaceMoodSettings(parsed.data.moods);

  return NextResponse.json({
    moods,
  });
}
