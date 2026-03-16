import { NextResponse } from "next/server";
import { z } from "zod";

import {
  listDefaultUtilTaskPrompts,
  listUtilTaskSettings,
  replaceUtilTaskSettings,
  utilTaskMcpServerLabels,
} from "@/lib/lmstudio/util-tasks";

const utilTaskSchema = z.object({
  name: z.string().min(1),
  prompt: z.string(),
  enabled: z.boolean().optional(),
  mcpServers: z.array(z.enum(utilTaskMcpServerLabels)).optional(),
});

const replaceUtilTasksSchema = z.object({
  tasks: z.array(utilTaskSchema),
});

export async function GET() {
  return NextResponse.json({
    tasks: listUtilTaskSettings(),
    defaults: listDefaultUtilTaskPrompts(),
  });
}

export async function PUT(req: Request) {
  const json = await req.json();
  const parsed = replaceUtilTasksSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  return NextResponse.json({
    tasks: replaceUtilTaskSettings(parsed.data.tasks),
  });
}


