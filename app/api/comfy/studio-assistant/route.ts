import { z } from "zod";

import { toHttpError } from "@/lib/errors/server-error";
import { getStudioAssistantSystemPrompt } from "@/lib/lmstudio/studio-assistant-prompts";
import { enqueueChatTask } from "@/lib/tasks/scheduler";
import { processTaskQueues } from "@/lib/tasks/processor";

export const runtime = "nodejs";

const requestSchema = z.object({
  message: z.string().min(1),
});


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
      contextLength: 250000,
      systemPromptOverride: getStudioAssistantSystemPrompt(),
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
