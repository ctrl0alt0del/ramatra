import { z } from "zod";

import { toHttpError } from "@/lib/errors/server-error";
import { getConfiguredContextLengthForMode } from "@/lib/lmstudio/context-length";
import { enqueueChatTask } from "@/lib/tasks/scheduler";
import { processTaskQueues } from "@/lib/tasks/processor";

export const runtime = "nodejs";

const requestSchema = z.object({
  message: z.string().min(1),
});

const studioAssistantSystemPrompt = [
  "You are Studio Assistant for direct Comfy workflows.",
  "You are stateless per request.",
  "Goal: provide LoRA options for manual user download.",
  "Do NOT install or download files.",
  "",
  "Available tool:",
  "- search_civitai_loras(query, baseModel, limit)",
  "",
  "Algorithm (strict):",
  "1) Infer baseModel from user message:",
  "   - if message mentions qwen => qwen",
  "   - if message mentions chroma => chroma",
  "   - if message mentions illustrious or illustrios => illustrious",
  "   - otherwise => sdxl",
  "2) Call search_civitai_loras exactly once.",
  "3) Do not call any other tools.",
  "4) Output results and stop.",
  "",
  "Output format (required):",
  "- Output ONLY valid JSON.",
  "- No markdown, no prose, no tables, no code fences, no markers.",
  "",
  "JSON schema (return exactly this object shape):",
  "{",
  '  "items": [',
  "    {",
  '      "name": "string",',
  '      "model": "string",',
  '      "likes": number,',
  '      "downloads": number,',
  '      "imageUrl": "string|null",',
  '      "downloadUrl": "string",',
  '      "fileName": "string|null",',
  '      "baseModel": "sdxl|chroma|qwen|illustrious"',
  "    }",
  "  ]",
  "}",
].join("\n");

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const parsed = requestSchema.safeParse(json);

    if (!parsed.success) {
      return Response.json(
        { error: "Invalid request", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const task = enqueueChatTask({
      kind: "conversation",
      threadId: null,
      promptMode: "regular",
      moodId: null,
      persistent: false,
      previousResponseIdOverride: null,
      contextLength: getConfiguredContextLengthForMode("regular", process.env),
      systemPromptOverride: studioAssistantSystemPrompt,
      utilMcpServers: ["comfy_readonly"],
      userMessage: [{ type: "text", text: parsed.data.message.trim() }],
    });

    const streamTaskId =
      task.type === "chat"
        ? ((task.payload.tasks ?? []).find(
            (groupTask) => groupTask.kind === "chat.stream",
          )?.id ?? task.id)
        : task.id;

    void processTaskQueues();

    return Response.json(
      {
        taskId: streamTaskId,
        status: task.status,
      },
      { status: 202 },
    );
  } catch (error) {
    const httpErrorData = toHttpError(error);
    return new Response(httpErrorData.body, {
      status: httpErrorData.status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
