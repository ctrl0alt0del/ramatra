import { z } from "zod";

import {
  executeGenerateImage,
  generateImageToolName,
  getGenerateImageOpenAIToolSpec,
  parseGenerateImageArguments,
} from "@/lib/tools/generate-image";

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

const getLmStudioChatCompletionsUrl = () => {
  const rawBaseUrl = process.env.LM_STUDIO_BASE_URL;
  if (!rawBaseUrl) {
    throw new Error("LM_STUDIO_BASE_URL is not configured.");
  }

  const url = new URL(rawBaseUrl);
  if (!url.pathname.endsWith("/v1")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/v1`;
  }

  return `${url.toString().replace(/\/$/, "")}/chat/completions`;
};

type OpenAIChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenAIToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
  }>;
  error?: {
    message?: string;
  };
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
  const latestUserMessage = [...inputMessages]
    .reverse()
    .find((message) => message.role === "user");

  if (!latestUserMessage) {
    return Response.json(
      { error: "Chat request must include a user message." },
      { status: 400 },
    );
  }

  const lmStudioMessages: OpenAIChatMessage[] = [
    {
      role: "system",
      content: `You are a helpful assistant.

If the user asks to create, generate, render, draw, or make an image, call the generate_image function.
Do not fabricate image URLs or external image services.
For non-image requests, reply normally.`,
    },
    latestUserMessage,
  ];

  const response = await fetch(getLmStudioChatCompletionsUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.LM_STUDIO_TOKEN
        ? { Authorization: `Bearer ${process.env.LM_STUDIO_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      model: process.env.LM_STUDIO_MODEL,
      messages: lmStudioMessages,
      tools: [getGenerateImageOpenAIToolSpec()],
      tool_choice: "auto",
    }),
  });

  const data = (await response.json()) as ChatCompletionResponse;
  if (!response.ok) {
    return Response.json(
      {
        error:
          data.error?.message ??
          "LM Studio chat completion request failed.",
      },
      { status: response.status },
    );
  }

  const choice = data.choices?.[0]?.message;
  if (!choice) {
    return Response.json(
      { error: "LM Studio did not return a chat choice." },
      { status: 502 },
    );
  }

  const generateImageCall = choice.tool_calls?.find(
    (toolCall) => toolCall.function.name === generateImageToolName,
  );

  if (!generateImageCall) {
    return Response.json({
      text: choice.content?.trim() ?? "",
    });
  }

  try {
    const toolInput = parseGenerateImageArguments(
      generateImageCall.function.arguments,
    );
    const toolResult = await executeGenerateImage(toolInput);

    return Response.json({
      text: toolResult.ok
        ? `Started generating your image.\n\n${toolResult.marker}`
        : toolResult.error,
    });
  } catch (error) {
    return Response.json({
      text: `Image generation failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    });
  }
}
