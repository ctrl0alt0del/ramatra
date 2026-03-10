import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type ModelMessage } from "ai";
import { z } from "zod";
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
});

const lmstudio = createOpenAI({
  baseURL: process.env.LM_STUDIO_BASE_URL,
  apiKey: process.env.LM_STUDIO_TOKEN,
});

const toModelMessages = (
  messages: Array<z.infer<typeof messageSchema>>,
): ModelMessage[] => {
  const result: ModelMessage[] = [];

  for (const message of messages) {
    const text = (message.content ?? [])
      .flatMap((part) =>
        part.type === "text" && typeof part.text === "string"
          ? [part.text]
          : [],
      )
      .join("\n\n")
      .trim();

    if (!text) continue;

    result.push({
      role: message.role,
      content: text,
    });
  }

  return result;
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

  const inputMessages = toModelMessages(parsed.data.messages);
  const result = await generateText({
    model: lmstudio(process.env.LM_STUDIO_MODEL!),
    messages: inputMessages,
  });

  return Response.json({
    text: result.text,
  });
}
