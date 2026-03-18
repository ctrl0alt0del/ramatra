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

import {
  deleteThread,
  getThreadWithAllMessages,
  updateThread,
} from "@/lib/lmstudio/threads";

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.union([z.string(), z.array(z.union([textPartSchema, imagePartSchema]))]),
});

const updateThreadSchema = z.object({
  title: z.string().optional(),
  titleGenerated: z.boolean().optional(),
  status: z.enum(["regular", "archived"]).optional(),
  lmstudioResponseId: z.string().nullable().optional(),
  lastPromptMode: z.enum(["fast", "regular", "writer", "artist"]).nullable().optional(),
  conversationSummary: z.string().nullable().optional(),
  summaryUpdatedAt: z.string().nullable().optional(),
  summaryMessageCount: z.number().int().nonnegative().optional(),
  summaryCallCountTotal: z.number().int().nonnegative().optional(),
  summaryCallsInCurrentRequest: z.number().int().nonnegative().optional(),
  contextWindowUsedTokens: z.number().int().nonnegative().nullable().optional(),
  contextWindowTotalTokens: z.number().int().positive().nullable().optional(),
  appendMessages: z.array(messageSchema).optional(),
  replaceMessages: z.array(messageSchema).optional(),
  regenerateOfLastAssistant: z.boolean().optional(),
});

type RouteContext = {
  params: Promise<{ threadId: string }>;
};

export async function GET(_req: Request, context: RouteContext) {
  const { threadId } = await context.params;
  const thread = getThreadWithAllMessages(threadId);

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

  const thread = updateThread(threadId, {
    ...parsed.data,
    appendMessages: parsed.data.appendMessages?.map((message) => ({
      role: message.role,
      content: normalizeMessageContent(message.content),
    })),
    replaceMessages: parsed.data.replaceMessages?.map((message) => ({
      role: message.role,
      content: normalizeMessageContent(message.content),
    })),
  });

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



