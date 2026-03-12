import { extractComfyJobMarker } from "@/components/chat/comfy-marker";
import { type MessagePart } from "@/lib/chat/message-content";
import { getStoredGeneration } from "@/lib/comfy/generations";
import { type ThreadMessage } from "@/lib/lmstudio/threads";
import { getTask } from "@/lib/tasks/store";

const GENERATED_IMAGE_LOOKBACK_MESSAGES = 6;
const GENERATED_IMAGE_LIMIT = 4;

const getJobIdForMarker = (taskId: string, jobId: string | null | undefined) => {
  if (jobId) {
    return jobId;
  }

  const task = getTask(taskId);
  if (!task || task.type !== "comfy") {
    return null;
  }

  return task.result?.jobId ?? null;
};

export const getGeneratedImagesForThread = (messages: ThreadMessage[]) => {
  const recentAssistantMessages = messages
    .filter((message) => message.role === "assistant")
    .slice(-GENERATED_IMAGE_LOOKBACK_MESSAGES);

  const images: MessagePart[] = [];
  const seenJobIds = new Set<string>();

  for (const message of recentAssistantMessages.reverse()) {
    const textContent = message.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");

    if (!textContent.trim()) {
      continue;
    }

    const { marker } = extractComfyJobMarker(textContent);
    if (!marker) {
      continue;
    }

    const resolvedJobId = getJobIdForMarker(marker.taskId, marker.jobId);
    if (!resolvedJobId || seenJobIds.has(resolvedJobId)) {
      continue;
    }

    const generation = getStoredGeneration(resolvedJobId);
    if (!generation || generation.status !== "completed") {
      continue;
    }

    seenJobIds.add(resolvedJobId);

    for (const [index, image] of generation.images.entries()) {
      images.push({
        type: "image",
        dataUrl: `data:${image.mimeType};base64,${image.data}`,
        mimeType: image.mimeType,
        name: `comfy-${resolvedJobId}-${index + 1}`,
      });

      if (images.length >= GENERATED_IMAGE_LIMIT) {
        return images;
      }
    }
  }

  return images;
};
