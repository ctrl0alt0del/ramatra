import { NextResponse } from "next/server";
import { z } from "zod";

import {
  deleteThread,
  getThread,
  updateThread,
} from "@/lib/lmstudio/threads";

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

const updateThreadSchema = z.object({
  title: z.string().optional(),
  status: z.enum(["regular", "archived"]).optional(),
  lmstudioResponseId: z.string().nullable().optional(),
  appendMessages: z.array(messageSchema).optional(),
  replaceMessages: z.array(messageSchema).optional(),
});

type RouteContext = {
  params: Promise<{ threadId: string }>;
};

export async function GET(_req: Request, context: RouteContext) {
  const { threadId } = await context.params;
  const thread = getThread(threadId);

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  return NextResponse.json({ thread });
}

export async function PATCH(req: Request, context: RouteContext) {
  const { threadId } = await context.params;
  const json = await req.json();
  const parsed = updateThreadSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const thread = updateThread(threadId, parsed.data);

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  return NextResponse.json({ thread });
}

export async function DELETE(_req: Request, context: RouteContext) {
  const { threadId } = await context.params;
  const deleted = deleteThread(threadId);

  if (!deleted) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
