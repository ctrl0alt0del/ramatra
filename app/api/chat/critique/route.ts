import { z } from "zod";

import { extractComfyJobMarker } from "@/components/chat/comfy-marker";
import { getStoredGeneration } from "@/lib/comfy/generations";
import { getThreadWithAllMessages } from "@/lib/lmstudio/threads";
import { getConfiguredContextLengthForMode } from "@/lib/lmstudio/context-length";
import { processTaskQueues } from "@/lib/tasks/processor";
import { enqueueChatTask } from "@/lib/tasks/scheduler";
import { getTask } from "@/lib/tasks/store";

export const runtime = "nodejs";

const requestSchema = z.object({
  comfyTaskId: z.string().min(1),
  imageIndex: z.number().int().nonnegative().default(0),
  threadId: z.string().min(1),
  parentMessageId: z.string().nullable().optional(),
  moodId: z.string().nullable().optional(),
});

const resolveMessageIdFromThread = (
  fullThread:
    | {
        messages: Array<{ id?: string; messageUiId?: string | null }>;
      }
    | null,
  candidateIdOrUiId: string | null,
) => {
  if (!fullThread || !candidateIdOrUiId) {
    return null;
  }

  const needle = candidateIdOrUiId.trim();
  if (!needle) {
    return null;
  }

  const byId = fullThread.messages.find((message) => message.id === needle);
  if (byId?.id) {
    return byId.id;
  }

  const byUiId = fullThread.messages.find(
    (message) => message.messageUiId === needle,
  );

  return byUiId?.id ?? null;
};

const inferCritiqueParentFromMarker = (
  fullThread: ReturnType<typeof getThreadWithAllMessages>,
  comfyTaskId: string,
  jobId: string | null,
) => {
  if (!fullThread) {
    return null;
  }

  for (let index = fullThread.messages.length - 1; index >= 0; index -= 1) {
    const message = fullThread.messages[index];
    if (message.role !== "assistant") {
      continue;
    }

    const text = message.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
    if (!text.trim()) {
      continue;
    }

    const { marker } = extractComfyJobMarker(text);
    if (!marker) {
      continue;
    }

    const markerMatchesTask = marker.taskId === comfyTaskId;
    const markerMatchesJob =
      typeof jobId === "string" &&
      jobId.length > 0 &&
      typeof marker.jobId === "string" &&
      marker.jobId.length > 0 &&
      marker.jobId === jobId;

    if (markerMatchesTask || markerMatchesJob) {
      return message.id ?? null;
    }
  }

  return null;
};

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
  const moodId = parsed.data.moodId?.trim() ? parsed.data.moodId.trim() : null;
  const requestedParentMessageId = parsed.data.parentMessageId?.trim()
    ? parsed.data.parentMessageId.trim()
    : null;
  const hasExplicitParentSelection = parsed.data.parentMessageId !== undefined;
  const fullThread = getThreadWithAllMessages(threadId);
  if (!fullThread) {
    return Response.json({ error: "Thread not found." }, { status: 404 });
  }

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

  const normalizedRequestedParentId = resolveMessageIdFromThread(
    fullThread,
    requestedParentMessageId,
  );
  const inferredMarkerParentId = inferCritiqueParentFromMarker(
    fullThread,
    comfyTaskId,
    jobId,
  );
  const resolvedParentMessageId = hasExplicitParentSelection
    ? normalizedRequestedParentId
    : (inferredMarkerParentId ?? fullThread.activeLeafMessageId ?? null);

  const critiqueTask = enqueueChatTask({
    kind: "critique",
    threadId,
    moodId,
    comfyTaskId,
    imageIndex,
    parentMessageId: resolvedParentMessageId,
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
