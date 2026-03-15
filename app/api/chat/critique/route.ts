import { z } from "zod";

import { getStoredGeneration } from "@/lib/comfy/generations";
import { getConfiguredContextLengthForMode } from "@/lib/lmstudio/context-length";
import { processTaskQueues } from "@/lib/tasks/processor";
import { enqueueChatTask } from "@/lib/tasks/scheduler";
import { getTask } from "@/lib/tasks/store";

export const runtime = "nodejs";

const requestSchema = z.object({
  comfyTaskId: z.string().min(1),
  imageIndex: z.number().int().nonnegative().default(0),
  threadId: z.string().min(1),
});

export async function POST(req: Request) {
  const json = await req.json();
  const parsed = requestSchema.safeParse(json);

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid critique request.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { comfyTaskId, imageIndex, threadId } = parsed.data;
  const comfyTask = getTask(comfyTaskId);
  if (!comfyTask || comfyTask.type !== "comfy") {
    return Response.json({ error: "Comfy task not found." }, { status: 404 });
  }

  const jobId = comfyTask.result?.jobId ?? null;
  if (!jobId) {
    return Response.json(
      { error: "Comfy task has no associated generation job." },
      { status: 400 },
    );
  }

  const generation = getStoredGeneration(jobId);
  if (!generation || generation.status !== "completed") {
    return Response.json(
      { error: "Generation is not completed yet." },
      { status: 400 },
    );
  }

  if (!generation.images[imageIndex]) {
    return Response.json(
      { error: "Requested image index is out of range." },
      { status: 400 },
    );
  }

  const critiqueTask = enqueueChatTask({
    kind: "critique",
    threadId,
    comfyTaskId,
    imageIndex,
    contextLength: getConfiguredContextLengthForMode("artist", process.env),
  });

  const streamTaskId =
    critiqueTask.type === "chat"
      ? (critiqueTask.payload.tasks ?? []).find(
          (groupTask) => groupTask.kind === "chat.stream",
        )?.id ?? critiqueTask.id
      : critiqueTask.id;

  void processTaskQueues();

  return Response.json(
    {
      taskId: streamTaskId,
      critiqueTaskId: critiqueTask.id,
      status: critiqueTask.status,
    },
    { status: 202 },
  );
}
