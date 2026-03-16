import { z } from "zod";

import {
  hasUsableMessageContent,
  serializeMessageContent,
  type MessagePart,
} from "@/lib/chat/message-content";
import { createThread, getThread, updateThread } from "@/lib/lmstudio/threads";
import { getConfiguredContextLengthForMode } from "@/lib/lmstudio/context-length";
import { defaultPromptMode, isPromptMode } from "@/lib/lmstudio/prompt-modes";
import { processTaskQueues } from "@/lib/tasks/processor";
import { enqueueChatTask } from "@/lib/tasks/scheduler";

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

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.array(z.union([textPartSchema, imagePartSchema])).optional(),
});

const requestSchema = z.object({
  messages: z.array(messageSchema),
  threadId: z.string().optional(),
  promptMode: z.string().optional(),
  moodId: z.string().nullable().optional(),
});

const toChatMessages = (messages: Array<z.infer<typeof messageSchema>>) => {
  return messages
    .map((message) => {
      const content = (message.content ?? []) as MessagePart[];
      if (!hasUsableMessageContent(content)) return null;

      return {
        role: message.role,
        content,
      };
    })
    .filter(
      (
        message,
      ): message is {
        role: "system" | "user" | "assistant";
        content: MessagePart[];
      } => {
        return message !== null;
      },
    );
};

export async function POST(req: Request) {
  const json = await req.json();
  const parsed = requestSchema.safeParse(json);

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid chat request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const inputMessages = toChatMessages(parsed.data.messages);
  const latestInputMessage = inputMessages.at(-1) ?? null;
  const promptMode =
    parsed.data.promptMode && isPromptMode(parsed.data.promptMode)
      ? parsed.data.promptMode
      : defaultPromptMode;
  const latestUserMessage = [...inputMessages]
    .reverse()
    .find((message) => message.role === "user");

  if (!latestUserMessage) {
    return Response.json(
      { error: "Chat request must include a user message." },
      { status: 400 },
    );
  }

  const requestedThreadId =
    parsed.data.threadId && !parsed.data.threadId.startsWith("__LOCALID_")
      ? parsed.data.threadId
      : undefined;
  const existingThread = requestedThreadId ? getThread(requestedThreadId) : null;

  const thread =
    existingThread ??
    createThread({
      title: "New Chat",
      messages: [
        {
          role: "user",
          content: latestUserMessage.content,
        },
      ],
    });

  const latestUserMessageSerialized = serializeMessageContent(
    latestUserMessage.content,
  );
  const isRegenerateRequest =
    Boolean(existingThread) && latestInputMessage?.role !== "user";

  if (existingThread) {
    const lastMessage = existingThread.messages.at(-1);
    const shouldAppendUserMessage =
      latestInputMessage?.role === "user" &&
      (!lastMessage ||
        lastMessage.role !== "user" ||
        serializeMessageContent(lastMessage.content) !==
          latestUserMessageSerialized);

    if (shouldAppendUserMessage) {
      updateThread(existingThread.id, {
        appendMessages: [
          {
            role: "user",
            content: latestUserMessage.content,
          },
        ],
      });
    }
  }

  const moodId = parsed.data.moodId?.trim() ? parsed.data.moodId.trim() : null;

  const task = enqueueChatTask({
    kind: "conversation",
    threadId: thread.id,
    promptMode,
    moodId,
    contextLength: getConfiguredContextLengthForMode(promptMode, process.env),
    userMessage: latestUserMessage.content,
    regenerateOfLastAssistant: isRegenerateRequest,
  });
  if (!isRegenerateRequest) {
    enqueueChatTask({
      kind: "update_intent",
      threadId: thread.id,
      userMessage: latestUserMessage.content,
      contextLength: getConfiguredContextLengthForMode(promptMode, process.env),
    });
  }
  const streamTaskId =
    task.type === "chat"
      ? (task.payload.tasks ?? []).find(
          (groupTask) => groupTask.kind === "chat.stream",
        )?.id ?? task.id
      : task.id;

  void processTaskQueues();

  return Response.json(
    {
      taskId: streamTaskId,
      threadId: thread.id,
      status: task.status,
    },
    { status: 202 },
  );
}



