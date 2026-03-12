import { NextResponse } from "next/server";
import { z } from "zod";

import { normalizeMessageContent } from "@/lib/chat/message-content";
const textPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const imagePartSchema = z.object({
  type: z.literal("image"),
  dataUrl: z.string(),
  mimeType: z.string().optional(),
  name: z.string().optional(),
});

import { createThread, listThreads } from "@/lib/lmstudio/threads";

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.union([z.string(), z.array(z.union([textPartSchema, imagePartSchema]))]),
});

const createThreadSchema = z.object({
  title: z.string().optional(),
  titleGenerated: z.boolean().optional(),
  status: z.enum(["regular", "archived"]).optional(),
  lmstudioResponseId: z.string().nullable().optional(),
  messages: z.array(messageSchema).optional(),
});

export async function GET() {
  return NextResponse.json({ threads: listThreads() });
}

export async function POST(req: Request) {
  const json = await req.json();
  const parsed = createThreadSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const thread = createThread({
    ...parsed.data,
    messages: parsed.data.messages?.map((message) => ({
      role: message.role,
      content: normalizeMessageContent(message.content),
    })),
  });
  return NextResponse.json({ thread }, { status: 201 });
}
