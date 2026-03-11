import { z } from "zod";

import { defaultPromptMode, isPromptMode } from "@/lib/lmstudio/prompt-modes";
import { processTaskQueues } from "@/lib/tasks/processor";
import { enqueueChatTask } from "@/lib/tasks/scheduler";

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z
    .array(
      z.object({
        type: z.string(),
        text: z.string().optional(),
      }),
    )
    .optional(),
});

const requestSchema = z.object({
  messages: z.array(messageSchema),
  threadId: z.string().optional(),
  promptMode: z.string().optional(),
});

const toChatMessages = (messages: Array<z.infer<typeof messageSchema>>) => {
  return messages
    .map((message) => {
      const text = (message.content ?? [])
        .flatMap((part) =>
          part.type === "text" && typeof part.text === "string"
            ? [part.text]
            : [],
        )
        .join("\n\n")
        .trim();

      if (!text) return null;

      return {
        role: message.role,
        content: text,
      };
    })
    .filter(
      (
        message,
      ): message is {
        role: "system" | "user" | "assistant";
        content: string;
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

  const task = enqueueChatTask({
    threadId: parsed.data.threadId ?? null,
    promptMode,
    userMessage: latestUserMessage.content,
  });

  void processTaskQueues();

  return Response.json(
    {
      taskId: task.id,
      status: task.status,
    },
    { status: 202 },
  );
}
