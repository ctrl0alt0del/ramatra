import { z } from "zod";

import { toHttpError } from "@/lib/errors/server-error";
import { enqueueChatTask } from "@/lib/tasks/scheduler";
import { processTaskQueues } from "@/lib/tasks/processor";

export const runtime = "nodejs";

const requestSchema = z.object({
  message: z.string().min(1),
});

const studioAssistantSystemPrompt = [
  "You are Studio Assistant router for Direct Comfy workflows.",
  "You are stateless per request and must never rely on previous messages.",
  "Your job is only to choose the correct util task stage based on user request.",
  "Do not execute any external actions in this router step.",
  "Do not output JSON in this router step.",
  "",
  "Routing rules:",
  "- If user asks to find/search/recommend LoRAs, output stage studio_lora_find.",
  "- If user asks to improve/enhance/rewrite/optimize prompt, route by workflow:",
  "  - edit workflow => studio_prompt_edit_enhance",
  "  - illustration workflow => studio_prompt_illustration_enhance",
  "  - base workflow or unknown workflow => studio_prompt_base_enhance",
  "- Infer workflow from user intent when not explicit: edit for modifying existing image, illustration for stylized/anime/drawing tags, otherwise base.",
  "- If both LoRA search and prompt enhancement are requested, prefer studio_lora_find.",
  "",
  "Output format (required, and nothing else):",
  "[[util_task]]",
  "stage: <STAGE_NAME>",
  "context_text: <ORIGINAL_USER_MESSAGE>",
  "[[/util_task]]",
  "",
  "Replace placeholders with exact values.",
  "No prose, no markdown, no extra lines before or after the block.",
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
      contextLength: 64000,
      systemPromptOverride: studioAssistantSystemPrompt,
      utilMcpServers: [],
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
